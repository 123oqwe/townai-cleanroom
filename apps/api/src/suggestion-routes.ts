import type { Hono } from "hono";
import { z } from "zod";

import { asId } from "@town/contracts";
import {
  suggestionStatusSchema,
  type SuggestionRepository,
} from "@town/suggestions";
import type { AuthVariables } from "./auth.js";

export function registerSuggestionRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  repository: SuggestionRepository,
): void {
  app.get("/v1/suggestions", async (context) => {
    const ownerId = context.get("identity").user.id;
    const query = z
      .object({
        status: suggestionStatusSchema.default("open"),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .strict()
      .parse(context.req.query());
    return context.json({
      suggestions: await repository.list(ownerId, query.status, query.limit),
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
    return context.json({
      suggestion: await repository.transition(
        ownerId,
        asId<"suggestion">(z.uuidv7().parse(context.req.param("suggestionId"))),
        body.expectedRevision,
        body.status,
      ),
    });
  });
}
