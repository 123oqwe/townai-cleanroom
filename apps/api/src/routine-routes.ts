import type { Hono } from "hono";
import { z } from "zod";

import { asId } from "@town/contracts";
import type { RoutineRepository } from "@town/routines";
import type { AuthVariables } from "./auth.js";

export interface RoutineDependencies {
  repository: RoutineRepository;
}

const createRoutineSchema = z
  .object({
    agentId: z.uuidv7(),
    agentVersionId: z.uuidv7(),
    name: z.string().trim().min(1).max(120),
    cron: z.string().trim().min(1),
    timezone: z.string().trim().min(1).max(100).default("UTC"),
    nextRunAt: z.iso.datetime(),
    enabled: z.boolean().default(true),
  })
  .strict();
const updateRoutineSchema = createRoutineSchema
  .extend({ expectedRevision: z.number().int().positive() })
  .strict();

export function registerRoutineRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: RoutineDependencies,
): void {
  app.get("/v1/routines", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      routines: await dependencies.repository.list(ownerId),
    });
  });

  app.get("/v1/routines/:routineId/runs", async (context) => {
    const ownerId = context.get("identity").user.id;
    const routineId = asRoutineId(context.req.param("routineId"));
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(50) })
      .strict()
      .parse(context.req.query());
    if (!(await dependencies.repository.ownsSchedule(ownerId, routineId)))
      return context.json({ error: "ROUTINE_NOT_FOUND" }, 404);
    return context.json({
      runs: await dependencies.repository.listRuns(
        ownerId,
        routineId,
        query.limit,
      ),
    });
  });

  app.post("/v1/routines", async (context) => {
    const ownerId = context.get("identity").user.id;
    const input = createRoutineSchema.parse(await context.req.json());
    const routine = await dependencies.repository.create({
      ...input,
      ownerId,
      nextRunAt: new Date(input.nextRunAt),
    });
    return context.json({ routine }, 201);
  });

  app.patch("/v1/routines/:routineId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const input = updateRoutineSchema.parse(await context.req.json());
    const routine = await dependencies.repository.update({
      ...input,
      id: context.req.param("routineId"),
      ownerId,
      nextRunAt: new Date(input.nextRunAt),
    });
    return context.json({ routine });
  });

  app.delete("/v1/routines/:routineId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const query = z
      .object({ expectedRevision: z.coerce.number().int().positive() })
      .strict()
      .parse(context.req.query());
    await dependencies.repository.remove(
      ownerId,
      asRoutineId(context.req.param("routineId")),
      query.expectedRevision,
    );
    return context.body(null, 204);
  });

  app.get("/v1/routines/:routineId/webhook", async (context) => {
    const ownerId = context.get("identity").user.id;
    const webhook = await dependencies.repository.getWebhook(
      ownerId,
      asRoutineId(context.req.param("routineId")),
    );
    return webhook
      ? context.json({ webhook })
      : context.json({ error: "WEBHOOK_NOT_FOUND" }, 404);
  });

  app.post("/v1/routines/:routineId/webhook", async (context) => {
    const ownerId = context.get("identity").user.id;
    const result = await dependencies.repository.createWebhook(
      ownerId,
      asRoutineId(context.req.param("routineId")),
    );
    return context.json(result, 201);
  });

  app.patch("/v1/routines/:routineId/webhook", async (context) => {
    const ownerId = context.get("identity").user.id;
    const input = z
      .object({ enabled: z.boolean() })
      .strict()
      .parse(await context.req.json());
    return context.json({
      webhook: await dependencies.repository.setWebhookEnabled(
        ownerId,
        asRoutineId(context.req.param("routineId")),
        input.enabled,
      ),
    });
  });
}

export function registerRoutineWebhookRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: RoutineDependencies,
): void {
  app.post("/v1/routine-webhooks/:routineId", async (context) => {
    const contentType = context.req.header("content-type")?.split(";", 1)[0];
    if (contentType !== "application/json" && contentType !== "text/plain")
      return context.json({ error: "UNSUPPORTED_CONTENT_TYPE" }, 415);
    const authorization = context.req.header("Authorization");
    const secret = authorization?.match(/^Bearer ([^\s,]+)$/)?.[1];
    const idempotencyKey = context.req.header("X-Town-Idempotency-Key");
    if (!secret || !idempotencyKey)
      return context.json({ error: "NOT_FOUND" }, 404);
    const raw = await context.req.text();
    let payload: Record<string, unknown>;
    if (contentType === "application/json") {
      const parsed: unknown = JSON.parse(raw);
      payload = z.record(z.string(), z.unknown()).parse(parsed);
    } else {
      payload = { text: raw };
    }
    const delivery = await dependencies.repository.deliverWebhook(
      secret,
      idempotencyKey,
      payload,
    );
    if (!delivery) return context.json({ error: "NOT_FOUND" }, 404);
    return context.json(
      { runId: delivery.runId, duplicate: delivery.duplicate },
      202,
    );
  });
}

function asRoutineId(value: string) {
  return asId<"routine-schedule">(z.uuidv7().parse(value));
}
