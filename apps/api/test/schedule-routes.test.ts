import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

import { asId } from "@town/contracts";
import type { AccountRepository } from "@town/identity";
import type { TaskRepository } from "@town/agents";
import type { GoogleApiClient } from "@town/google";
import type { RoutineRepository } from "@town/routines";
import type { AuthVariables } from "../src/lib/auth.js";
import { registerScheduleRoutes } from "../src/routes/schedule-routes.js";

const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");
const accountId = asId<"connected-account">(
  "01900000-0000-7000-8000-000000000002",
);

describe("schedule routes", () => {
  it("aggregates local tasks/routines and isolates calendar failures", async () => {
    const tasks = {
      list: vi.fn().mockResolvedValue({
        items: [
          {
            task: {
              id: "01900000-0000-7000-8000-000000000003",
              title: "Follow up",
              status: "open",
              scheduledFor: new Date("2026-08-04T09:00:00.000Z"),
            },
          },
        ],
        nextCursor: null,
      }),
    } as unknown as TaskRepository;
    const routines = {
      list: vi.fn().mockResolvedValue([
        {
          id: "01900000-0000-7000-8000-000000000004",
          name: "Morning Briefing",
          enabled: true,
          nextRunAt: new Date("2026-08-05T08:00:00.000Z"),
        },
      ]),
    } as unknown as RoutineRepository;
    const accounts = {
      listByOwner: vi.fn().mockResolvedValue([
        {
          id: accountId,
          provider: "google",
          isActive: true,
          credentialPresent: true,
          email: "person@example.com",
        },
      ]),
    } as unknown as AccountRepository;
    const google = {
      calendarListCalendars: vi.fn().mockResolvedValue({
        items: [{ id: "primary", summary: "Primary" }],
      }),
      calendarListEvents: vi
        .fn()
        .mockRejectedValue(new Error("calendar unavailable")),
    } as unknown as GoogleApiClient;
    const app = new Hono<{ Variables: AuthVariables }>();
    app.use("*", async (context, next) => {
      context.set("identity", {
        user: { id: ownerId },
      } as AuthVariables["identity"]);
      await next();
    });
    registerScheduleRoutes(app, { tasks, routines, accounts, google });

    const response = await app.request(
      "http://town.test/v1/schedule?from=2026-08-03T00:00:00.000Z&to=2026-08-10T00:00:00.000Z&limit=10",
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: Array<{ kind: string; source: string }>;
      calendarErrors: Array<{ accountId: string }>;
    };
    expect(body.items.map((item) => item.kind)).toEqual(["task", "routine"]);
    expect(body.items.every((item) => item.source.startsWith("local_"))).toBe(
      true,
    );
    expect(body.calendarErrors).toEqual([
      { accountId, calendarId: "primary", code: "Error" },
    ]);
    expect(tasks.list).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId, limit: 10 }),
    );
  });
});
