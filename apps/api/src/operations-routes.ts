import type { Hono } from "hono";
import { z } from "zod";

import {
  auditOutcomeSchema,
  type OperationsRepository,
} from "@town/operations";
import type { AuthVariables } from "./auth.js";

export interface OperationsDependencies {
  repository: OperationsRepository;
}
const querySchema = z
  .object({
    action: z.string().trim().min(1).max(200).optional(),
    outcome: auditOutcomeSchema.optional(),
    cursor: z.string().min(1).max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export function registerOperationsRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: OperationsDependencies,
): void {
  app.get("/v1/operations/audit", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      audit: await dependencies.repository.list({
        ownerId,
        ...querySchema.parse(context.req.query()),
      }),
    });
  });
  app.get("/v1/operations/summary", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      summary: await dependencies.repository.summary(ownerId),
    });
  });
}
