import type { Hono } from "hono";
import { z } from "zod";

import {
  auditOutcomeSchema,
  presenceSurfaceSchema,
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
const analyticsEventSchema = z
  .object({
    eventName: z.string().trim().min(1).max(200),
    metadata: z.record(z.string(), z.json()).default({}),
    dedupeKey: z.string().trim().min(1).max(500).nullable().optional(),
  })
  .strict();
const analyticsQuerySchema = z
  .object({
    eventName: z.string().trim().min(1).max(200).optional(),
    cursor: z.string().min(1).max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
const presenceSchema = z
  .object({
    sessionId: z.string().trim().min(1).max(200),
    surface: presenceSurfaceSchema,
    clientSha: z.string().trim().min(1).max(200).nullable().optional(),
    deploymentTime: z.coerce.date().nullable().optional(),
    userAgent: z.string().trim().max(1_000).nullable().optional(),
    intervalSeconds: z.coerce.number().int().min(5).max(120).default(30),
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
  app.post("/v1/analytics/events", async (context) => {
    const ownerId = context.get("identity").user.id;
    const body = analyticsEventSchema.parse(await context.req.json());
    return context.json(
      {
        event: await dependencies.repository.appendAnalytics({
          ownerId,
          ...body,
        }),
      },
      201,
    );
  });
  app.get("/v1/analytics/events", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      events: await dependencies.repository.listAnalytics({
        ownerId,
        ...analyticsQuerySchema.parse(context.req.query()),
      }),
    });
  });
  app.post("/v1/presence/heartbeat", async (context) => {
    const ownerId = context.get("identity").user.id;
    const body = presenceSchema.parse(await context.req.json());
    return context.json({
      presence: await dependencies.repository.heartbeatPresence({
        ownerId,
        ...body,
      }),
    });
  });
  app.get("/v1/presence", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      presence: await dependencies.repository.listPresence(ownerId),
    });
  });
}
