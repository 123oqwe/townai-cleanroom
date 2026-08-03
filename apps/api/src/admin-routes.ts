import type { Sql } from "postgres";
import type { Hono } from "hono";
import { z } from "zod";

import type { OperationsRepository } from "@town/operations";
import { asId } from "@town/contracts";
import type { BillingRepository } from "@town/billing";
import type { AuthVariables } from "./auth.js";

export interface AdminDependencies {
  sql: Sql;
  operations: OperationsRepository;
  harnessReady: boolean;
  workerEnabled: boolean;
  googleOAuthReady: boolean;
  billing?: BillingRepository;
}

const userIdSchema = z.uuidv7();
const periodQuerySchema = z
  .object({
    start: z.iso.datetime().optional(),
    end: z.iso.datetime().optional(),
  })
  .strict();

function resolvePeriod(query: Record<string, string | undefined>) {
  const value = periodQuerySchema.parse(query);
  const end = value.end === undefined ? new Date() : new Date(value.end);
  const start =
    value.start === undefined
      ? new Date(end.getTime() - 30 * 24 * 60 * 60 * 1_000)
      : new Date(value.start);
  if (
    start >= end ||
    end.getTime() - start.getTime() > 366 * 24 * 60 * 60 * 1_000
  )
    throw new z.ZodError([
      {
        code: "custom",
        path: ["period"],
        message: "Billing period must be positive and at most one year.",
      },
    ]);
  return { start, end };
}

/**
 * Clean-room administrative health: it reports safe operational counters and
 * readiness, never prompts, credentials, provider payloads, or private Town
 * implementation details.
 */
export function registerAdminRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: AdminDependencies,
): void {
  app.get("/v1/admin/agent-health/:userId", async (context) => {
    const userId = userIdSchema.parse(context.req.param("userId"));
    const [user] = await dependencies.sql<
      { id: string; email: string; status: string; created_at: Date }[]
    >`
      select id,email,status,created_at
      from users
      where id=${userId}
    `;
    if (!user) return context.json({ code: "USER_NOT_FOUND" }, 404);
    const summary = await dependencies.operations.summary(asId<"user">(userId));
    return context.json({
      user: {
        id: user.id,
        email: user.email,
        status: user.status,
        createdAt: user.created_at,
      },
      readiness: {
        api: true,
        harness: dependencies.harnessReady,
        worker: dependencies.workerEnabled,
        googleOAuth: dependencies.googleOAuthReady,
      },
      summary,
    });
  });
  app.get("/v1/admin/billing-reconciliation/:userId", async (context) => {
    const userId = userIdSchema.parse(context.req.param("userId"));
    const [user] = await dependencies.sql<
      { id: string; email: string; status: string }[]
    >`select id,email,status from users where id=${userId}`;
    if (!user) return context.json({ code: "USER_NOT_FOUND" }, 404);
    const period = resolvePeriod(context.req.query());
    const billing = dependencies.billing
      ? await dependencies.billing.get(asId<"user">(userId))
      : null;
    const usage = dependencies.billing
      ? await dependencies.billing.summarize(
          asId<"user">(userId),
          period.start,
          period.end,
        )
      : [];
    return context.json({
      user: { id: user.id, email: user.email, status: user.status },
      period,
      status:
        billing === null
          ? ("not_configured" as const)
          : ("configured" as const),
      billing,
      usage,
      reconciliation: {
        externalProvider: "not_configured" as const,
        discrepancy: null,
      },
    });
  });
}
