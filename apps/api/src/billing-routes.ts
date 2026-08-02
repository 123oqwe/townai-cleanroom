import type { Hono } from "hono";
import { z } from "zod";

import type { BillingRepository } from "@town/billing";
import type { AuthVariables } from "./auth.js";

export interface BillingDependencies {
  repository: BillingRepository;
}
export function registerBillingRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: BillingDependencies,
): void {
  app.get("/v1/billing", async (context) => {
    const ownerId = context.get("identity").user.id;
    const state = await dependencies.repository.get(ownerId);
    if (!state) return context.json({ status: "not_configured" as const });
    const query = z
      .object({
        start: z.iso.datetime().optional(),
        end: z.iso.datetime().optional(),
      })
      .strict()
      .parse(context.req.query());
    const end = query.end === undefined ? new Date() : new Date(query.end);
    const start =
      query.start === undefined
        ? new Date(end.getTime() - 30 * 24 * 60 * 60 * 1_000)
        : new Date(query.start);
    return context.json({
      status: "configured" as const,
      billing: state,
      usage: await dependencies.repository.summarize(ownerId, start, end),
      period: { start, end },
    });
  });
}
