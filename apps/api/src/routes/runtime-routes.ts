import type { Hono } from "hono";
import { z } from "zod";

import { turnMentionsInputSchema } from "@town/agents";
import { asId } from "@town/contracts";
import type { BillingRepository } from "@town/billing";
import {
  sessionRunStateSchema,
  type ApprovalDecisionRepository,
  type RuntimeTransitionService,
  type SessionRepository,
} from "@town/runtime";

import type { AuthVariables } from "../lib/auth.js";

export interface RuntimeDependencies {
  sessionRepository: SessionRepository;
  runtimeTransitionService: RuntimeTransitionService;
  approvalDecisions?: ApprovalDecisionRepository;
  billingRepository?: BillingRepository;
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
const streamQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    intervalMs: z.coerce.number().int().min(250).max(5_000).default(1_000),
    windowMs: z.coerce.number().int().min(1_000).max(25_000).default(20_000),
  })
  .strict();
const runPageQuerySchema = pageQuerySchema
  .extend({ state: sessionRunStateSchema.optional() })
  .strict();
const emptyBodySchema = z.object({}).strict();
const resumeSchema = z
  .object({
    expectedState: z.enum(["waiting_approval", "waiting_user_input"]),
  })
  .strict();
const approvalDecisionSchema = z
  .object({
    approvalId: z.string().trim().min(1).max(500),
    decision: z.enum(["approve", "reject"]),
  })
  .strict();
const inputResponseSchema = z
  .object({ response: z.string().trim().min(1).max(50_000) })
  .strict();

export function registerRuntimeRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: RuntimeDependencies,
): void {
  app.post("/v1/threads/:threadId/messages", async (context) => {
    const ownerId = context.get("identity").user.id;
    const billing =
      dependencies.billingRepository === undefined
        ? null
        : await dependencies.billingRepository.get(ownerId);
    if (billing?.isBlocked === true)
      return context.json(
        {
          type: "https://town.local/problems/billing-blocked",
          title: "Credits unavailable",
          status: 402,
          detail: "This account is blocked from starting new assistant work.",
          code: "BILLING_BLOCKED",
        },
        402,
      );
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

  app.post("/v1/sessions/:sessionId/runs/:runId/resume", async (context) => {
    const ownerId = context.get("identity").user.id;
    const sessionId = asId<"runtime-session">(context.req.param("sessionId"));
    const runId = asId<"session-run">(context.req.param("runId"));
    const body = resumeSchema.parse(await context.req.json());
    const run = await dependencies.runtimeTransitionService.resume({
      ownerId,
      sessionId,
      runId,
      expectedState: body.expectedState,
    });
    return context.json({ run }, 202);
  });

  app.post("/v1/sessions/:sessionId/runs/:runId/approval", async (context) => {
    if (dependencies.approvalDecisions === undefined)
      return context.json({ code: "APPROVAL_DECISIONS_NOT_CONFIGURED" }, 503);
    const ownerId = context.get("identity").user.id;
    const sessionId = asId<"runtime-session">(context.req.param("sessionId"));
    const runId = asId<"session-run">(context.req.param("runId"));
    const body = approvalDecisionSchema.parse(await context.req.json());
    const decision = await dependencies.approvalDecisions.record({
      ownerId,
      sessionId,
      runId,
      approvalId: body.approvalId,
      decision: body.decision,
    });
    const run = await dependencies.runtimeTransitionService.resume({
      ownerId,
      sessionId,
      runId,
      expectedState: "waiting_approval",
    });
    return context.json({ decision, run }, 202);
  });

  app.post("/v1/sessions/:sessionId/runs/:runId/input", async (context) => {
    const ownerId = context.get("identity").user.id;
    const sessionId = asId<"runtime-session">(context.req.param("sessionId"));
    const runId = asId<"session-run">(context.req.param("runId"));
    const body = inputResponseSchema.parse(await context.req.json());
    const run = await dependencies.runtimeTransitionService.answerInput({
      ownerId,
      sessionId,
      runId,
      response: body.response,
    });
    return context.json({ run }, 202);
  });

  app.get("/v1/sessions/:sessionId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const sessionId = asId<"runtime-session">(context.req.param("sessionId"));
    return context.json({
      session: await dependencies.sessionRepository.get(ownerId, sessionId),
    });
  });

  app.get("/v1/runtime-input-requests", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      runs: await dependencies.sessionRepository.listWaitingInput(ownerId),
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

  app.get("/v1/sessions/:sessionId/events/stream", async (context) => {
    const ownerId = context.get("identity").user.id;
    const sessionId = asId<"runtime-session">(context.req.param("sessionId"));
    const query = streamQuerySchema.parse(context.req.query());
    const session = await dependencies.sessionRepository.get(
      ownerId,
      sessionId,
    );
    if (session === null)
      return context.json({ error: "SESSION_NOT_FOUND" }, 404);

    const encoder = new TextEncoder();
    const signal = context.req.raw.signal;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let cursor = query.cursor;
        let lastSequence = 0;
        const startedAt = Date.now();
        const write = (value: string) => {
          if (!signal.aborted) controller.enqueue(encoder.encode(value));
        };
        const wait = async (milliseconds: number) => {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, milliseconds);
            if (signal.aborted) {
              clearTimeout(timer);
              resolve();
            }
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
          });
        };
        try {
          while (!signal.aborted && Date.now() - startedAt < query.windowMs) {
            const page = await dependencies.sessionRepository.listEvents({
              ownerId,
              sessionId,
              ...(cursor === undefined ? {} : { cursor }),
              limit: 100,
            });
            let emitted = false;
            for (const event of page.items) {
              if (event.sequence <= lastSequence) continue;
              lastSequence = event.sequence;
              emitted = true;
              write(
                `id: ${event.sequence}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`,
              );
            }
            if (page.nextCursor !== null) cursor = page.nextCursor;
            if (!emitted) write(`: heartbeat ${new Date().toISOString()}\n\n`);
            await wait(query.intervalMs);
          }
          write("event: end\ndata: {}\n\n");
        } catch (error) {
          if (!signal.aborted) {
            write(
              `event: error\ndata: ${JSON.stringify({ code: "EVENT_STREAM_FAILED", detail: error instanceof Error ? error.message : "Event stream failed." })}\n\n`,
            );
          }
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
        "x-accel-buffering": "no",
      },
    });
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
