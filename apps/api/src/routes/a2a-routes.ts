import type { Hono } from "hono";
import { z } from "zod";
import { asId } from "@town/contracts";
import { a2aStatusSchema, type A2ARepository } from "@town/a2a";
import type { AuthVariables } from "../lib/auth.js";

export function registerA2ARoutes(
  app: Hono<{ Variables: AuthVariables }>,
  repository: A2ARepository,
): void {
  app.get("/v1/a2a/requests", async (c) => {
    const query = z
      .object({ status: a2aStatusSchema.optional() })
      .strict()
      .parse(c.req.query());
    return c.json({
      requests: await repository.listForUser(
        c.get("identity").user.id,
        query["status"],
      ),
    });
  });
  app.post("/v1/a2a/requests", async (c) => {
    const body = z
      .object({
        recipientId: z.uuidv7(),
        capability: z.string().trim().min(1).max(200),
        request: z.record(z.string(), z.json()),
        expiresAt: z.coerce.date().nullable().optional(),
      })
      .strict()
      .parse(await c.req.json());
    return c.json(
      {
        request: await repository.create({
          ...body,
          requesterId: c.get("identity").user.id,
          recipientId: asId<"user">(body.recipientId),
        }),
      },
      201,
    );
  });
  app.patch("/v1/a2a/requests/:requestId", async (c) => {
    const body = z
      .object({
        status: z.enum(["accepted", "declined", "cancelled", "completed"]),
        expectedRevision: z.number().int().positive(),
        result: z.record(z.string(), z.json()).optional(),
      })
      .strict()
      .parse(await c.req.json());
    const input = {
      userId: c.get("identity").user.id,
      requestId: asId<"a2a-request">(
        z.uuidv7().parse(c.req.param("requestId")),
      ),
      status: body.status,
      revision: body.expectedRevision,
      ...(body.result === undefined ? {} : { result: body.result }),
    };
    return c.json({ request: await repository.transition(input) });
  });
  app.post("/v1/a2a/requests/:requestId/consent", async (c) => {
    const body = z
      .object({
        decision: z.enum(["grant", "deny", "revoke"]),
        expectedRevision: z.number().int().positive(),
        scope: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
      })
      .strict()
      .parse(await c.req.json());
    return c.json({
      request: await repository.consent({
        userId: c.get("identity").user.id,
        requestId: asId<"a2a-request">(
          z.uuidv7().parse(c.req.param("requestId")),
        ),
        revision: body.expectedRevision,
        decision: body.decision,
        scope: body.scope,
      }),
    });
  });
}
