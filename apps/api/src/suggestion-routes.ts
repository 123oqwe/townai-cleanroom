import type { Hono } from "hono";
import { z } from "zod";

import { asId } from "@town/contracts";
import type { AgentRepository } from "@town/agents";
import {
  suggestionStatusSchema,
  type SuggestionRepository,
} from "@town/suggestions";
import type { AuthVariables } from "./auth.js";

export function registerSuggestionRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  repository: SuggestionRepository,
  agents?: AgentRepository,
): void {
  app.get("/v1/suggestions", async (context) => {
    const ownerId = context.get("identity").user.id;
    const query = z
      .object({
        status: suggestionStatusSchema.default("open"),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        cursor: z.string().min(1).max(500).optional(),
      })
      .strict()
      .parse(context.req.query());
    const page = await repository.listPage({ ownerId, ...query });
    return context.json({
      suggestions: page.items,
      nextCursor: page.nextCursor,
    });
  });
  app.patch("/v1/suggestions/:suggestionId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const body = z
      .object({
        expectedRevision: z.number().int().positive(),
        status: z.enum(["dismissed", "converted"]),
      })
      .strict()
      .parse(await context.req.json());
    const suggestionId = asId<"suggestion">(
      z.uuidv7().parse(context.req.param("suggestionId")),
    );
    if (body.status === "dismissed")
      return context.json({
        suggestion: await repository.transition(
          ownerId,
          suggestionId,
          body.expectedRevision,
          body.status,
        ),
      });
    if (agents === undefined)
      return context.json({ error: "RUNTIME_NOT_CONFIGURED" }, 503);
    const agent = await agents.getPersonal(ownerId);
    return context.json(
      await repository.convertToTask({
        ownerId,
        id: suggestionId,
        expectedRevision: body.expectedRevision,
        agentId: agent.id,
        approvalMode: agent.activeVersion.snapshot.defaultApprovalMode,
      }),
    );
  });
}
