import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { z } from "zod";

import { asId } from "@town/contracts";
import type { AuthenticatedIdentity } from "@town/identity";
import type {
  SessionRepository,
  RuntimeTransitionService,
  ApprovalDecisionRepository,
} from "@town/runtime";
import type { BillingRepository } from "@town/billing";
import type { AuthVariables } from "../src/lib/auth.js";
import { registerRuntimeRoutes } from "../src/routes/runtime-routes.js";

const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");
const threadId = asId<"thread">("01900000-0000-7000-8000-000000000002");
const authSessionId = asId<"auth-session">(
  "01900000-0000-7000-8000-000000000009",
);
const sessionId = asId<"runtime-session">(
  "01900000-0000-7000-8000-000000000003",
);
const runId = asId<"session-run">("01900000-0000-7000-8000-000000000004");
const approvalId = asId<"approval-request">(
  "01900000-0000-7000-8000-000000000005",
);
const runtimeIdentity: AuthenticatedIdentity = {
  user: {
    id: ownerId,
    email: "owner@example.invalid",
    firstName: null,
    lastName: null,
    timezone: "UTC",
    status: "active",
  },
  session: {
    id: authSessionId,
    userId: ownerId,
    expiresAt: new Date("2026-08-01T00:00:00.000Z"),
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    lastSeenAt: new Date("2026-08-01T00:00:00.000Z"),
  },
};

function withErrorMapping(app: Hono<{ Variables: AuthVariables }>) {
  app.onError((error, context) => {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return context.json({ code: "INVALID_REQUEST" }, 400);
    }
    return context.json({ code: "INTERNAL_ERROR" }, 500);
  });
}

function withIdentity(app: Hono<{ Variables: AuthVariables }>) {
  app.use("*", async (context, next) => {
    context.set("identity", runtimeIdentity);
    await next();
  });
}

function buildRuntimeApp(
  sessionRepository: SessionRepository,
  runtimeTransitionService: RuntimeTransitionService,
  overrides?: {
    approvalDecisions?: ApprovalDecisionRepository;
    billingRepository?: BillingRepository;
  },
) {
  const app = new Hono<{ Variables: AuthVariables }>();
  withErrorMapping(app);
  withIdentity(app);
  registerRuntimeRoutes(app, {
    sessionRepository,
    runtimeTransitionService,
    ...overrides,
  });
  return app;
}

describe("runtime routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("submits messages, resumes runs, records inputs, and queries runtime resources", async () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    const session = {
      id: sessionId,
      ownerId,
      threadId,
      agentId: asId<"agent">("01900000-0000-7000-8000-000000000010"),
      state: "active" as const,
      revision: 1,
      lastEventSequence: 0,
      agentVersion: {
        id: asId<"agent-version">("01900000-0000-7000-8000-000000000011"),
        agentId: asId<"agent">("01900000-0000-7000-8000-000000000010"),
        version: 1,
        snapshot: {},
        changeReason: null,
        createdBy: "user" as const,
        createdAt: now,
      },
      createdAt: now,
      updatedAt: now,
    };
    const run = {
      id: runId,
      sessionId,
      triggeringTurnId: asId<"thread-turn">(
        "01900000-0000-7000-8000-000000000012",
      ),
      state: "queued" as const,
      attempt: 1,
      waitReason: null,
      inputResponse: null,
      outcome: null,
      errorCode: null,
      createdAt: now,
      startedAt: now,
      finishedAt: null,
      updatedAt: now,
    };
    const turn = {
      id: asId<"thread-turn">("01900000-0000-7000-8000-000000000013"),
      ownerId,
      sessionId,
      kind: "user" as const,
      role: "user" as const,
      text: "hello",
      mentions: [],
      state: "submitted",
      error: null,
      createdAt: now,
    };
    const resumedRun = {
      ...run,
      state: "running" as const,
      waitReason: null,
      updatedAt: now,
    };
    const inputSubmitted = { ...run, inputResponse: "confirm" };
    const waiting = [run];
    const runEvents = {
      items: [
        {
          id: asId<"session-event">("01900000-0000-7000-8000-000000000014"),
          sessionId,
          runId,
          sequence: 1,
          kind: "run_started" as const,
          payload: { stage: "start" },
          createdAt: now,
        },
      ],
      nextCursor: null,
    };

    const sessionRepository = {
      submitMessage: vi.fn(async () => ({
        session,
        run,
        turn,
        replayed: false,
      })),
      get: vi.fn(async () => session),
      listWaitingInput: vi.fn(async () => waiting),
      listRuns: vi.fn(async () => ({ items: [run], nextCursor: null })),
      listEvents: vi.fn(async () => runEvents),
    } as unknown as SessionRepository;
    const runtimeTransitionService = {
      resume: vi.fn(async () => resumedRun),
      answerInput: vi.fn(async () => inputSubmitted),
      cancel: vi.fn(async () => run),
    } as unknown as RuntimeTransitionService;

    const app = buildRuntimeApp(sessionRepository, runtimeTransitionService);

    const submit = await app.request(
      `http://town.test/v1/threads/${threadId}/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "msg-key-1",
        },
        body: JSON.stringify({ text: "Start a run", mentions: [] }),
      },
    );
    expect(submit.status).toBe(202);
    expect(await submit.json()).toMatchObject({
      session: { id: session.id, ownerId, threadId, state: "active" },
      run: { id: run.id, state: "queued", attempt: 1 },
      turn: { id: turn.id, role: "user", kind: "user" },
      replayed: false,
    });
    expect(sessionRepository.submitMessage).toHaveBeenCalledWith({
      ownerId,
      threadId,
      idempotencyKey: "msg-key-1",
      text: "Start a run",
      mentions: [],
    });

    const resumed = await app.request(
      `http://town.test/v1/sessions/${sessionId}/runs/${runId}/resume`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedState: "waiting_approval" }),
      },
    );
    expect(resumed.status).toBe(202);
    expect(await resumed.json()).toMatchObject({
      run: { id: resumedRun.id, state: "running" },
    });
    expect(runtimeTransitionService.resume).toHaveBeenCalledWith({
      ownerId,
      sessionId,
      runId,
      expectedState: "waiting_approval",
    });

    const input = await app.request(
      `http://town.test/v1/sessions/${sessionId}/runs/${runId}/input`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response: "confirm" }),
      },
    );
    expect(input.status).toBe(202);
    expect(await input.json()).toMatchObject({
      run: { id: inputSubmitted.id, inputResponse: "confirm" },
    });
    expect(runtimeTransitionService.answerInput).toHaveBeenCalledWith({
      ownerId,
      sessionId,
      runId,
      response: "confirm",
    });

    const sessionResponse = await app.request(
      `http://town.test/v1/sessions/${sessionId}`,
    );
    expect(sessionResponse.status).toBe(200);
    expect(await sessionResponse.json()).toMatchObject({
      session: { id: sessionId, state: "active" },
    });
    expect(sessionRepository.get).toHaveBeenCalledWith(ownerId, sessionId);

    const waitingInput = await app.request(
      "http://town.test/v1/runtime-input-requests",
    );
    expect(waitingInput.status).toBe(200);
    expect(await waitingInput.json()).toMatchObject({
      runs: [
        {
          ...run,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          startedAt: now.toISOString(),
        },
      ],
    });

    const runs = await app.request(
      `http://town.test/v1/sessions/${sessionId}/runs?state=queued&limit=25&cursor=eyJvZmZzZXQiOjF9`,
    );
    expect(runs.status).toBe(200);
    expect(await runs.json()).toMatchObject({
      items: [{ id: run.id }],
      nextCursor: null,
    });
    expect(sessionRepository.listRuns).toHaveBeenCalledWith({
      ownerId,
      sessionId,
      state: "queued",
      cursor: "eyJvZmZzZXQiOjF9",
      limit: 25,
    });
    const listRunsCalls = (
      sessionRepository.listRuns as unknown as ReturnType<typeof vi.fn>
    ).mock.calls;
    const listRunsFirstCall = listRunsCalls[0]?.[0];
    if (listRunsFirstCall === undefined)
      throw new Error("expected sessionRepository.listRuns to be called");
    expect(listRunsFirstCall).toMatchObject({
      limit: 25,
      state: "queued",
      cursor: "eyJvZmZzZXQiOjF9",
    });

    const eventsResponse = await app.request(
      `http://town.test/v1/sessions/${sessionId}/events?cursor=cursor-one&limit=10`,
    );
    expect(eventsResponse.status).toBe(200);
    expect(await eventsResponse.json()).toMatchObject({
      items: [{ kind: "run_started", sequence: 1 }],
      nextCursor: null,
    });
    expect(sessionRepository.listEvents).toHaveBeenCalledWith({
      ownerId,
      sessionId,
      cursor: "cursor-one",
      limit: 10,
    });

    const cancelled = await app.request(
      `http://town.test/v1/sessions/${sessionId}/runs/${runId}/cancel`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({
      run: { id: run.id, state: "queued" },
    });
    expect(runtimeTransitionService.cancel).toHaveBeenCalledWith({
      ownerId,
      sessionId,
      runId,
    });
  });

  it("blocks message submission when billing is blocked", async () => {
    const sessionRepository = {
      submitMessage: vi.fn(),
      get: vi.fn(),
      listWaitingInput: vi.fn(),
      listRuns: vi.fn(),
      listEvents: vi.fn(),
    } as unknown as SessionRepository;
    const runtimeTransitionService = {
      resume: vi.fn(),
      answerInput: vi.fn(),
      cancel: vi.fn(),
    } as unknown as RuntimeTransitionService;
    const billingRepository = {
      get: vi.fn(async () => ({ isBlocked: true })),
    } as unknown as BillingRepository;

    const app = buildRuntimeApp(sessionRepository, runtimeTransitionService, {
      billingRepository,
    });
    const response = await app.request(
      `http://town.test/v1/threads/${threadId}/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "blocked-message",
        },
        body: JSON.stringify({ text: "Should be blocked", mentions: [] }),
      },
    );

    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ code: "BILLING_BLOCKED" });
    expect(sessionRepository.submitMessage).not.toHaveBeenCalled();
  });

  it("requires approval service and records decision in runtime", async () => {
    const approvalDecisions = {
      record: vi.fn(async () => ({ approvalId: approvalId })),
    } as unknown as ApprovalDecisionRepository;
    const runtimeTransitionService = {
      resume: vi.fn(async () => ({
        id: runId,
        state: "queued" as const,
        sessionId,
      })),
      answerInput: vi.fn(),
      cancel: vi.fn(),
    } as unknown as RuntimeTransitionService;
    const sessionRepository = {
      submitMessage: vi.fn(),
      get: vi.fn(),
      listWaitingInput: vi.fn(),
      listRuns: vi.fn(),
      listEvents: vi.fn(),
    } as unknown as SessionRepository;
    const app = buildRuntimeApp(sessionRepository, runtimeTransitionService, {
      approvalDecisions,
    });

    const first = await app.request(
      `http://town.test/v1/sessions/${sessionId}/runs/${runId}/approval`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvalId: "app-1", decision: "approve" }),
      },
    );
    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({
      decision: { approvalId: approvalId },
      run: { id: runId, state: "queued" },
    });
    expect(approvalDecisions.record).toHaveBeenCalledWith({
      ownerId,
      sessionId,
      runId,
      approvalId: "app-1",
      decision: "approve",
    });
    expect(runtimeTransitionService.resume).toHaveBeenCalledWith({
      ownerId,
      sessionId,
      runId,
      expectedState: "waiting_approval",
    });
  });

  it("returns errors for malformed runtime requests", async () => {
    const sessionRepository = {
      submitMessage: vi.fn(),
      get: vi.fn(async () => null),
      listWaitingInput: vi.fn(),
      listRuns: vi.fn(),
      listEvents: vi.fn(),
    } as unknown as SessionRepository;
    const runtimeTransitionService = {
      resume: vi.fn(),
      answerInput: vi.fn(),
      cancel: vi.fn(),
    } as unknown as RuntimeTransitionService;
    const app = buildRuntimeApp(sessionRepository, runtimeTransitionService);

    const badSubmit = await app.request(
      `http://town.test/v1/threads/${threadId}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "", mentions: [] }),
      },
    );
    const missingHeader = await app.request(
      `http://town.test/v1/threads/${threadId}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "No idempotency", mentions: [] }),
      },
    );
    const badApproval = await app.request(
      `http://town.test/v1/sessions/${sessionId}/runs/${runId}/approval`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvalId: "x", decision: "invalid" }),
      },
    );
    const missingRun = await app.request(
      `http://town.test/v1/sessions/${sessionId}/events/stream?intervalMs=250&windowMs=1000`,
      {
        method: "GET",
      },
    );

    expect(await badSubmit.json()).toMatchObject({ code: "INVALID_REQUEST" });
    expect(await missingHeader.json()).toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(await badApproval.json()).toMatchObject({
      code: "APPROVAL_DECISIONS_NOT_CONFIGURED",
    });
    expect(await missingRun.json()).toMatchObject({
      error: "SESSION_NOT_FOUND",
    });
  });

  it("streams runtime events with SSE framing", async () => {
    const session = {
      id: sessionId,
      ownerId,
      threadId,
      agentId: asId<"agent">("01900000-0000-7000-8000-000000000020"),
      state: "active" as const,
      revision: 1,
      lastEventSequence: 2,
      agentVersion: {
        id: asId<"agent-version">("01900000-0000-7000-8000-000000000021"),
        agentId: asId<"agent">("01900000-0000-7000-8000-000000000020"),
        version: 1,
        snapshot: {},
        changeReason: null,
        createdBy: "user" as const,
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
      },
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    };
    const now = new Date("2026-08-01T00:00:00.000Z");
    const firstPage = {
      items: [
        {
          id: asId<"session-event">("01900000-0000-7000-8000-000000000022"),
          sessionId,
          runId,
          sequence: 1,
          kind: "run_started" as const,
          payload: { event: "started" },
          createdAt: now,
        },
      ],
      nextCursor: null,
    };
    const sessionRepository = {
      submitMessage: vi.fn(),
      get: vi.fn(async () => session),
      listWaitingInput: vi.fn(),
      listRuns: vi.fn(),
      listEvents: vi.fn(async () => firstPage),
    } as unknown as SessionRepository;
    const runtimeTransitionService = {
      resume: vi.fn(),
      answerInput: vi.fn(),
      cancel: vi.fn(),
    } as unknown as RuntimeTransitionService;
    const app = buildRuntimeApp(sessionRepository, runtimeTransitionService);

    const response = await app.request(
      `http://town.test/v1/sessions/${sessionId}/events/stream?intervalMs=250&windowMs=1000`,
    );
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain("event: run_started");
    expect(text).toContain("event: end");
    expect(text).toContain(`id: 1`);
  });
});
