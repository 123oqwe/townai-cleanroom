import type { Hono } from "hono";
import { z } from "zod";

import { turnMentionsInputSchema } from "@town/agents";
import { asId } from "@town/contracts";
import {
  sessionRunStateSchema,
  type RuntimeTransitionService,
  type SessionRepository,
} from "@town/runtime";

import type { AuthVariables } from "./auth.js";

export interface RuntimeDependencies {
  sessionRepository: SessionRepository;
  runtimeTransitionService: RuntimeTransitionService;
}

const messageSchema = z
  .object({
    text: z.string().trim().min(1).max(100_000),
    mentions: turnMentionsInputSchema,
  })
  .strict();
const idempotencyKeySchema = z.string().min(1).max(500);
const pageQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
const runPageQuerySchema = pageQuerySchema
  .extend({ state: sessionRunStateSchema.optional() })
  .strict();
const emptyBodySchema = z.object({}).strict();

export function registerRuntimeRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: RuntimeDependencies,
): void {
  app.post("/v1/threads/:threadId/messages", async (context) => {
    const ownerId = context.get("identity").user.id;
    const threadId = asId<"thread">(context.req.param("threadId"));
    const idempotencyKey = idempotencyKeySchema.parse(
      context.req.header("Idempotency-Key"),
    );
    const body = messageSchema.parse(await context.req.json());
    const submission = await dependencies.sessionRepository.submitMessage({
      ownerId,
      threadId,
      idempotencyKey,
      ...body,
    });
    return context.json(submission, 202);
  });

  app.get("/v1/sessions/:sessionId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const sessionId = asId<"runtime-session">(context.req.param("sessionId"));
    return context.json({
      session: await dependencies.sessionRepository.get(ownerId, sessionId),
    });
  });

  app.get("/v1/sessions/:sessionId/runs", async (context) => {
    const ownerId = context.get("identity").user.id;
    const sessionId = asId<"runtime-session">(context.req.param("sessionId"));
    const query = runPageQuerySchema.parse(context.req.query());
    return context.json(
      await dependencies.sessionRepository.listRuns({
        ownerId,
        sessionId,
        ...(query.state === undefined ? {} : { state: query.state }),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        limit: query.limit,
      }),
    );
  });

  app.get("/v1/sessions/:sessionId/events", async (context) => {
    const ownerId = context.get("identity").user.id;
    const sessionId = asId<"runtime-session">(context.req.param("sessionId"));
    const query = pageQuerySchema.parse(context.req.query());
    return context.json(
      await dependencies.sessionRepository.listEvents({
        ownerId,
        sessionId,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        limit: query.limit,
      }),
    );
  });

  app.post("/v1/sessions/:sessionId/runs/:runId/cancel", async (context) => {
    const ownerId = context.get("identity").user.id;
    const sessionId = asId<"runtime-session">(context.req.param("sessionId"));
    const runId = asId<"session-run">(context.req.param("runId"));
    emptyBodySchema.parse(await context.req.json());
    const run = await dependencies.runtimeTransitionService.cancel({
      ownerId,
      sessionId,
      runId,
    });
    return context.json({ run });
  });
}
