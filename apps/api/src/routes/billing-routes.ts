import type { Hono } from "hono";
import { z } from "zod";

import type { BillingRepository } from "@town/billing";
import type { AuthVariables } from "../lib/auth.js";

export interface BillingDependencies {
  repository: BillingRepository;
}

const billingPeriodSchema = z
  .object({
    start: z.iso.datetime().optional(),
    end: z.iso.datetime().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const end = value.end === undefined ? new Date() : new Date(value.end);
    const start =
      value.start === undefined
        ? new Date(end.getTime() - 30 * 24 * 60 * 60 * 1_000)
        : new Date(value.start);
    if (
      start >= end ||
      end.getTime() - start.getTime() > 366 * 24 * 60 * 60 * 1_000
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["period"],
        message: "Billing period must be positive and at most one year.",
      });
    }
  });

function resolvePeriod(query: Record<string, string | undefined>) {
  const value = billingPeriodSchema.parse(query);
  const end = value.end === undefined ? new Date() : new Date(value.end);
  const start =
    value.start === undefined
      ? new Date(end.getTime() - 30 * 24 * 60 * 60 * 1_000)
      : new Date(value.start);
  return { start, end };
}

export function registerBillingRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: BillingDependencies,
): void {
  app.get("/v1/billing", async (context) => {
    const ownerId = context.get("identity").user.id;
    const state = await dependencies.repository.get(ownerId);
    if (!state) return context.json({ status: "not_configured" as const });
    const period = resolvePeriod(context.req.query());
    return context.json({
      status: "configured" as const,
      billing: state,
      usage: await dependencies.repository.summarize(
        ownerId,
        period.start,
        period.end,
      ),
      period,
    });
  });
}
