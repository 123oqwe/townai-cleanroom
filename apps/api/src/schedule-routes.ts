import type { Hono } from "hono";
import { z } from "zod";

import type { AccountRepository } from "@town/identity";
import type { TaskRepository } from "@town/agents";
import type { GoogleApiClient } from "@town/google";
import type { RoutineRepository } from "@town/routines";

import type { AuthVariables } from "./auth.js";

export interface ScheduleDependencies {
  tasks?: TaskRepository;
  routines?: RoutineRepository;
  accounts?: AccountRepository;
  google?: GoogleApiClient;
}

const querySchema = z
  .object({
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.from !== undefined && value.to !== undefined) {
      const from = new Date(value.from);
      const to = new Date(value.to);
      if (from >= to)
        context.addIssue({
          code: "custom",
          path: ["to"],
          message: "Schedule range end must be after its start.",
        });
      if (to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1_000)
        context.addIssue({
          code: "custom",
          path: ["to"],
          message: "Schedule range cannot exceed one year.",
        });
    }
  });

function eventDate(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const dateTime = record["dateTime"];
  const date = record["date"];
  if (typeof dateTime === "string") return dateTime;
  if (typeof date === "string") return `${date}T00:00:00.000Z`;
  return null;
}

export function registerScheduleRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: ScheduleDependencies,
): void {
  app.get("/v1/schedule", async (context) => {
    const ownerId = context.get("identity").user.id;
    const query = querySchema.parse(context.req.query());
    const from = new Date(query.from ?? new Date().toISOString());
    const to = new Date(
      query.to ??
        new Date(from.getTime() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
    );
    const items: Array<Record<string, unknown>> = [];
    if (dependencies.tasks !== undefined) {
      const page = await dependencies.tasks.list({
        ownerId,
        statuses: ["open"],
        scheduledFrom: from,
        scheduledTo: to,
        limit: query.limit,
      });
      for (const detail of page.items.map((item) => item.task)) {
        if (detail.scheduledFor === null) continue;
        items.push({
          kind: "task",
          id: detail.id,
          title: detail.title,
          startAt: detail.scheduledFor.toISOString(),
          endAt: detail.scheduledFor.toISOString(),
          status: detail.status,
          source: "local_task",
        });
      }
    }
    if (dependencies.routines !== undefined) {
      for (const routine of await dependencies.routines.list(ownerId)) {
        if (
          !routine.enabled ||
          routine.nextRunAt < from ||
          routine.nextRunAt > to
        )
          continue;
        items.push({
          kind: "routine",
          id: routine.id,
          title: routine.name,
          startAt: routine.nextRunAt.toISOString(),
          endAt: routine.nextRunAt.toISOString(),
          status: routine.enabled ? "enabled" : "disabled",
          source: "local_routine",
        });
      }
    }
    const calendarErrors: Array<{ accountId: string; code: string }> = [];
    if (
      dependencies.accounts !== undefined &&
      dependencies.google !== undefined
    ) {
      const accounts = await dependencies.accounts.listByOwner(ownerId);
      for (const account of accounts) {
        if (
          account.provider !== "google" ||
          !account.isActive ||
          !account.credentialPresent
        )
          continue;
        try {
          const result = await dependencies.google.calendarListEvents({
            ownerId,
            accountId: account.id,
            calendarId: "primary",
            timeMin: from.toISOString(),
            timeMax: to.toISOString(),
            maxResults: query.limit,
          });
          for (const event of result.items) {
            const startAt = eventDate(event["start"]);
            if (startAt === null) continue;
            const endAt = eventDate(event["end"]) ?? startAt;
            items.push({
              kind: "calendar",
              id: String(event["id"] ?? `${account.id}:${startAt}`),
              title: String(event["summary"] ?? "Calendar event"),
              startAt,
              endAt,
              status: String(event["status"] ?? "confirmed"),
              source: "google_calendar",
              accountId: account.id,
              accountEmail: account.email,
            });
          }
        } catch (error) {
          calendarErrors.push({
            accountId: account.id,
            code: error instanceof Error ? error.name : "CALENDAR_UNAVAILABLE",
          });
        }
      }
    }
    items.sort((left, right) => {
      const byTime = String(left["startAt"]).localeCompare(
        String(right["startAt"]),
      );
      return byTime === 0
        ? String(left["id"]).localeCompare(String(right["id"]))
        : byTime;
    });
    return context.json({
      items: items.slice(0, query.limit),
      range: { from, to },
      calendarErrors,
    });
  });
}
