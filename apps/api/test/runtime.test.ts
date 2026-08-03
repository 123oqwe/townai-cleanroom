import { randomBytes } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
} from "vitest";
import postgres, { type Sql } from "postgres";

import {
  createAgentRepository,
  createInputRequestRepository,
  createTaskRepository,
  createThreadRepository,
  createTurnRepository,
} from "@town/agents";
import { runMigrations } from "@town/db";
import {
  createAccountRepository,
  createCredentialCipher,
  createIdentityService,
} from "@town/identity";
import {
  createRuntimeTransitionService,
  createSessionRepository,
  createRuntimeQueueRepository,
  createApprovalDecisionRepository,
} from "@town/runtime";

import { createApp } from "../src/app.js";

let sql: Sql;

beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 8 });
  await runMigrations(sql);
});

beforeEach(async () => {
  await sql`truncate table users, access_allowlist cascade`;
});

afterAll(async () => {
  await sql.end();
});

async function fixture() {
  await sql`
    insert into access_allowlist (email, enabled)
    values ('runtime-api-owner@example.invalid', true),
           ('runtime-api-other@example.invalid', true)
  `;
  const identityService = createIdentityService(sql);
  const accountRepository = createAccountRepository(
    sql,
    createCredentialCipher(randomBytes(32).toString("base64url")),
  );
  const dependencies = {
    identityService,
    accountRepository,
    agentRepository: createAgentRepository(sql),
    threadRepository: createThreadRepository(sql),
    turnRepository: createTurnRepository(sql),
    taskRepository: createTaskRepository(sql),
    inputRequestRepository: createInputRequestRepository(sql),
    sessionRepository: createSessionRepository(sql),
    runtimeTransitionService: createRuntimeTransitionService(sql),
    approvalDecisions: createApprovalDecisionRepository(sql),
  };
  const owner = await identityService.establishIdentity({
    email: "runtime-api-owner@example.invalid",
    timezone: "Asia/Shanghai",
  });
  const other = await identityService.establishIdentity({
    email: "runtime-api-other@example.invalid",
    timezone: "UTC",
  });
  return {
    app: createApp(dependencies),
    dependencies: { ...dependencies, queue: createRuntimeQueueRepository(sql) },
    owner,
    other,
  };
}

function authorization(token: string, idempotencyKey?: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...(idempotencyKey === undefined
      ? {}
      : { "Idempotency-Key": idempotencyKey }),
  };
}

async function createThread(
  app: Awaited<ReturnType<typeof fixture>>["app"],
  token: string,
) {
  await app.request("/v1/agents/personal", {
    method: "POST",
    headers: authorization(token),
    body: JSON.stringify({
      displayName: "Runtime API Assistant",
      instructions: "Use only configured runtime adapters.",
      defaultApprovalMode: "require_approval",
    }),
  });
  const response = await app.request("/v1/threads", {
    method: "POST",
    headers: authorization(token),
    body: JSON.stringify({
      title: "Runtime API Thread",
      approvalMode: "require_approval",
    }),
  });
  return (await response.json()) as { thread: { id: string } };
}

describe("protected persistent Session API", () => {
  it("requires authentication and rejects missing keys or runtime-field spoofing", async () => {
    const { app, owner, other } = await fixture();
    const created = await createThread(app, owner.token);
    const unauthenticated = await app.request(
      `/v1/threads/${created.thread.id}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "No auth", mentions: [] }),
      },
    );
    const missingKey = await app.request(
      `/v1/threads/${created.thread.id}/messages`,
      {
        method: "POST",
        headers: authorization(owner.token),
        body: JSON.stringify({ text: "No key", mentions: [] }),
      },
    );
    const spoofed = await app.request(
      `/v1/threads/${created.thread.id}/messages`,
      {
        method: "POST",
        headers: authorization(owner.token, "spoof-attempt"),
        body: JSON.stringify({
          text: "Attempt to forge runtime state.",
          mentions: [],
          ownerId: other.user.id,
          role: "assistant",
          sourceType: "runtime",
          state: "completed",
          agentVersionId: other.user.id,
          leaseToken: "secret",
        }),
      },
    );
    const noWorkerClaim = await app.request("/v1/runtime/jobs/claim", {
      method: "POST",
      headers: authorization(owner.token),
      body: JSON.stringify({ workerId: "public-worker" }),
    });

    expect(unauthenticated.status).toBe(401);
    expect(missingKey.status).toBe(400);
    expect(spoofed.status).toBe(400);
    expect(noWorkerClaim.status).toBe(404);
  });

  it("accepts idempotent messages and exposes safe reconnectable reads", async () => {
    const { app, owner, other } = await fixture();
    const created = await createThread(app, owner.token);
    const submittedResponse = await app.request(
      `/v1/threads/${created.thread.id}/messages`,
      {
        method: "POST",
        headers: authorization(owner.token, "runtime-api-message-1"),
        body: JSON.stringify({
          text: "Queue this real user message.",
          mentions: [],
        }),
      },
    );
    expect(submittedResponse.status).toBe(202);
    const submitted = (await submittedResponse.json()) as {
      session: { id: string };
      run: { id: string; state: string };
      turn: { id: string; role: string };
      replayed: boolean;
    };
    expect(submitted).toMatchObject({
      replayed: false,
      run: { state: "queued" },
      turn: { role: "user" },
    });

    const replay = await app.request(
      `/v1/threads/${created.thread.id}/messages`,
      {
        method: "POST",
        headers: authorization(owner.token, "runtime-api-message-1"),
        body: JSON.stringify({
          text: "Queue this real user message.",
          mentions: [],
        }),
      },
    );
    const conflict = await app.request(
      `/v1/threads/${created.thread.id}/messages`,
      {
        method: "POST",
        headers: authorization(owner.token, "runtime-api-message-1"),
        body: JSON.stringify({ text: "Changed body.", mentions: [] }),
      },
    );
    expect(replay.status).toBe(202);
    expect(await replay.json()).toMatchObject({
      replayed: true,
      run: { id: submitted.run.id },
    });
    expect(conflict.status).toBe(409);

    const session = await app.request(`/v1/sessions/${submitted.session.id}`, {
      headers: authorization(owner.token),
    });
    const runs = await app.request(
      `/v1/sessions/${submitted.session.id}/runs?state=queued&limit=10`,
      { headers: authorization(owner.token) },
    );
    const events1 = await app.request(
      `/v1/sessions/${submitted.session.id}/events?limit=1`,
      { headers: authorization(owner.token) },
    );
    const firstPage = (await events1.json()) as {
      items: { sequence: number }[];
      nextCursor: string | null;
    };
    const events2 = await app.request(
      `/v1/sessions/${submitted.session.id}/events?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`,
      { headers: authorization(owner.token) },
    );
    const malformedEvents = await app.request(
      `/v1/sessions/${submitted.session.id}/events?cursor=%25%25%25`,
      { headers: authorization(owner.token) },
    );
    const secondThreadResponse = await app.request("/v1/threads", {
      method: "POST",
      headers: authorization(owner.token),
      body: JSON.stringify({
        title: "Second Runtime API Thread",
        approvalMode: "require_approval",
      }),
    });
    const secondThread = (await secondThreadResponse.json()) as {
      thread: { id: string };
    };
    const secondSubmissionResponse = await app.request(
      `/v1/threads/${secondThread.thread.id}/messages`,
      {
        method: "POST",
        headers: authorization(owner.token, "runtime-api-message-2"),
        body: JSON.stringify({ text: "Second Session input.", mentions: [] }),
      },
    );
    const secondSubmission = (await secondSubmissionResponse.json()) as {
      session: { id: string };
    };
    const mismatchedCursor = await app.request(
      `/v1/sessions/${secondSubmission.session.id}/events?cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`,
      { headers: authorization(owner.token) },
    );
    const otherSession = await app.request(
      `/v1/sessions/${submitted.session.id}`,
      { headers: authorization(other.token) },
    );
    const otherRuns = await app.request(
      `/v1/sessions/${submitted.session.id}/runs`,
      { headers: authorization(other.token) },
    );
    const otherEvents = await app.request(
      `/v1/sessions/${submitted.session.id}/events`,
      { headers: authorization(other.token) },
    );
    const noEventWrite = await app.request(
      `/v1/sessions/${submitted.session.id}/events`,
      {
        method: "POST",
        headers: authorization(owner.token),
        body: JSON.stringify({ kind: "run_completed", payload: {} }),
      },
    );

    expect(session.status).toBe(200);
    expect(runs.status).toBe(200);
    const sessionBody = await session.json();
    const runsBody = await runs.json();
    expect(runsBody).toMatchObject({
      items: [{ id: submitted.run.id, state: "queued" }],
    });
    expect(events1.status).toBe(200);
    expect(firstPage).toMatchObject({ items: [{ sequence: 1 }] });
    expect(events2.status).toBe(200);
    expect(await events2.json()).toMatchObject({ items: [{ sequence: 2 }] });
    expect(malformedEvents.status).toBe(400);
    expect(mismatchedCursor.status).toBe(404);
    expect(otherSession.status).toBe(404);
    expect(otherRuns.status).toBe(404);
    expect(otherEvents.status).toBe(404);
    expect(noEventWrite.status).toBe(404);

    const serialized = JSON.stringify({
      session: sessionBody,
      runs: runsBody,
      firstPage,
    });
    expect(serialized).not.toMatch(
      /leaseToken|lease_token|idempotency|requestFingerprint|providerPayload|token_hash/i,
    );
    const [assistantTurns] = await sql<{ count: number }[]>`
      select count(*)::int as count from thread_turns where role = 'assistant'
    `;
    expect(assistantTurns?.count).toBe(0);
  });

  it("cancels an owned Run once with stable conflict and not-found behavior", async () => {
    const { app, owner, other } = await fixture();
    const created = await createThread(app, owner.token);
    const response = await app.request(
      `/v1/threads/${created.thread.id}/messages`,
      {
        method: "POST",
        headers: authorization(owner.token, "runtime-api-cancel"),
        body: JSON.stringify({ text: "Cancel this queued Run.", mentions: [] }),
      },
    );
    const submitted = (await response.json()) as {
      session: { id: string };
      run: { id: string };
    };
    const otherCancel = await app.request(
      `/v1/sessions/${submitted.session.id}/runs/${submitted.run.id}/cancel`,
      {
        method: "POST",
        headers: authorization(other.token),
        body: JSON.stringify({}),
      },
    );
    const cancelled = await app.request(
      `/v1/sessions/${submitted.session.id}/runs/${submitted.run.id}/cancel`,
      {
        method: "POST",
        headers: authorization(owner.token),
        body: JSON.stringify({}),
      },
    );
    const again = await app.request(
      `/v1/sessions/${submitted.session.id}/runs/${submitted.run.id}/cancel`,
      {
        method: "POST",
        headers: authorization(owner.token),
        body: JSON.stringify({}),
      },
    );
    expect(otherCancel.status).toBe(404);
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({
      run: { id: submitted.run.id, state: "cancelled" },
    });
    expect(again.status).toBe(409);
  });

  it("exposes state-checked resume without allowing queued or cross-owner runs", async () => {
    const { app, owner, other } = await fixture();
    const created = await createThread(app, owner.token);
    const response = await app.request(
      `/v1/threads/${created.thread.id}/messages`,
      {
        method: "POST",
        headers: authorization(owner.token, "runtime-api-resume"),
        body: JSON.stringify({
          text: "Queue a waiting-state test.",
          mentions: [],
        }),
      },
    );
    const submitted = (await response.json()) as {
      session: { id: string };
      run: { id: string };
    };
    const otherResume = await app.request(
      `/v1/sessions/${submitted.session.id}/runs/${submitted.run.id}/resume`,
      {
        method: "POST",
        headers: authorization(other.token),
        body: JSON.stringify({ expectedState: "waiting_approval" }),
      },
    );
    const queuedResume = await app.request(
      `/v1/sessions/${submitted.session.id}/runs/${submitted.run.id}/resume`,
      {
        method: "POST",
        headers: authorization(owner.token),
        body: JSON.stringify({ expectedState: "waiting_approval" }),
      },
    );
    expect(otherResume.status).toBe(404);
    expect(queuedResume.status).toBe(409);
  });

  it("answers a waiting-user-input run through the protected route", async () => {
    const { app, owner, dependencies } = await fixture();
    const created = await createThread(app, owner.token);
    const submittedResponse = await app.request(
      `/v1/threads/${created.thread.id}/messages`,
      {
        method: "POST",
        headers: authorization(owner.token, "runtime-api-input"),
        body: JSON.stringify({ text: "Need input.", mentions: [] }),
      },
    );
    expect(submittedResponse.status).toBe(202);
    const submitted = (await submittedResponse.json()) as {
      session: { id: string };
      run: { id: string };
    };
    const lease = await dependencies.queue.claim({
      workerId: "input-route-worker",
      leaseMs: 10_000,
    });
    if (lease === null) throw new Error("Expected a lease.");
    await dependencies.runtimeTransitionService.start({
      runId: lease.runId,
      leaseToken: lease.leaseToken,
    });
    await dependencies.runtimeTransitionService.wait({
      runId: lease.runId,
      leaseToken: lease.leaseToken,
      state: "waiting_user_input",
      reason: "Need input",
    });
    const pending = await app.request("/v1/runtime-input-requests", {
      headers: authorization(owner.token),
    });
    expect(pending.status).toBe(200);
    expect(await pending.json()).toMatchObject({
      runs: [{ run: { id: submitted.run.id, state: "waiting_user_input" } }],
    });
    const response = await app.request(
      `/v1/sessions/${submitted.session.id}/runs/${submitted.run.id}/input`,
      {
        method: "POST",
        headers: authorization(owner.token),
        body: JSON.stringify({ response: "Confirmed." }),
      },
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      run: { state: "queued", inputResponse: "Confirmed." },
    });
  });

  it("records a Harness approval and requeues a waiting run atomically", async () => {
    const { app, owner, dependencies } = await fixture();
    const created = await createThread(app, owner.token);
    const submittedResponse = await app.request(
      `/v1/threads/${created.thread.id}/messages`,
      {
        method: "POST",
        headers: authorization(owner.token, "runtime-api-approval"),
        body: JSON.stringify({ text: "Wait for approval.", mentions: [] }),
      },
    );
    const submitted = (await submittedResponse.json()) as {
      session: { id: string };
      run: { id: string };
    };
    const lease = await dependencies.queue.claim({
      workerId: "approval-test-worker",
      leaseMs: 10_000,
    });
    expect(lease).not.toBeNull();
    if (lease === null)
      throw new Error("Expected the approval test run to be claimable.");
    await dependencies.runtimeTransitionService.start({
      runId: lease.runId,
      leaseToken: lease.leaseToken,
    });
    await dependencies.runtimeTransitionService.wait({
      runId: lease.runId,
      leaseToken: lease.leaseToken,
      state: "waiting_approval",
      reason: "Need permission",
    });
    const response = await app.request(
      `/v1/sessions/${submitted.session.id}/runs/${submitted.run.id}/approval`,
      {
        method: "POST",
        headers: authorization(owner.token),
        body: JSON.stringify({ approvalId: "approval-1", decision: "approve" }),
      },
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      decision: { approvalId: "approval-1", decision: "approve" },
      run: { state: "queued" },
    });
  });

  it("streams owner-scoped durable events with a bounded reconnect window", async () => {
    const { app, owner, other } = await fixture();
    const created = await createThread(app, owner.token);
    const submittedResponse = await app.request(
      `/v1/threads/${created.thread.id}/messages`,
      {
        method: "POST",
        headers: authorization(owner.token, "runtime-api-stream"),
        body: JSON.stringify({
          text: "Stream this queued event.",
          mentions: [],
        }),
      },
    );
    const submitted = (await submittedResponse.json()) as {
      session: { id: string };
    };
    const response = await app.request(
      `/v1/sessions/${submitted.session.id}/events/stream?intervalMs=250&windowMs=1000`,
      { headers: authorization(owner.token) },
    );
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain("event: run_queued");
    expect(text).toContain("event: end");

    const forbidden = await app.request(
      `/v1/sessions/${submitted.session.id}/events/stream?windowMs=1000`,
      { headers: authorization(other.token) },
    );
    expect(forbidden.status).toBe(404);
  });
});
