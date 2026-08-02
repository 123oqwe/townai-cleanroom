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
}

function asRoutineId(value: string) {
  return asId<"routine-schedule">(z.uuidv7().parse(value));
}
