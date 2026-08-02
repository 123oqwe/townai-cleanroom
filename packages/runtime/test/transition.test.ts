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

import { createAgentRepository, createThreadRepository } from "@town/agents";
import { newId, type Id } from "@town/contracts";
import { runMigrations } from "@town/db";

import { createRuntimeQueueRepository } from "../src/queue-repository.js";
import { createSessionRepository } from "../src/session-repository.js";
import { createRuntimeTransitionService } from "../src/transition-service.js";

let sql: Sql;
let ownerId: Id<"user">;

beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 8 });
  await runMigrations(sql);
});

beforeEach(async () => {
  await sql`truncate table users cascade`;
  ownerId = newId<"user">();
  await sql`
    insert into users (id, email, timezone)
    values (${ownerId}, 'transition-owner@example.invalid', 'UTC')
  `;
});

afterAll(async () => {
  await sql.end();
});

async function queuedRun(key: string) {
  const agent = await createAgentRepository(sql).createPersonal({
    ownerId,
    displayName: "Transition Test Assistant",
    instructions: "Use only explicit synthetic adapter output.",
    defaultApprovalMode: "require_approval",
  });
  const thread = await createThreadRepository(sql).createAssistant({
    ownerId,
    agentId: agent.id,
    title: "Runtime transition fixture",
    approvalMode: "require_approval",
  });
  return createSessionRepository(sql).submitMessage({
    ownerId,
    threadId: thread.id,
    idempotencyKey: key,
    text: "Run the synthetic transition fixture.",
    mentions: [],
  });
}

describe("runtime transitions", () => {
  it("records genuine output and completes through gapless immutable events", async () => {
    const submitted = await queuedRun("complete-run");
    const queue = createRuntimeQueueRepository(sql);
    const transitions = createRuntimeTransitionService(sql);
    const startedAt = new Date("2030-08-02T04:00:00.000Z");
    const lease = await queue.claim({
      workerId: "worker-complete",
      leaseMs: 60_000,
      now: startedAt,
    });
    if (lease === null) throw new Error("Expected a lease.");

    await transitions.start({
      runId: lease.runId,
      leaseToken: lease.leaseToken,
      now: startedAt,
    });
    await transitions.recordPhase({
      runId: lease.runId,
      leaseToken: lease.leaseToken,
      phase: "model_running",
      now: new Date("2030-08-02T04:00:01.000Z"),
    });
    const output = await transitions.recordAssistantOutput({
      runId: lease.runId,
      leaseToken: lease.leaseToken,
      text: "Explicit deterministic adapter output.",
      mentions: [],
      now: new Date("2030-08-02T04:00:02.000Z"),
    });
    expect(output).toMatchObject({
      role: "assistant",
      sourceType: "runtime",
      sourceRef: lease.runId,
      text: "Explicit deterministic adapter output.",
    });
    const completed = await transitions.complete({
      runId: lease.runId,
      leaseToken: lease.leaseToken,
      outcome: { summary: "Synthetic completion" },
      now: new Date("2030-08-02T04:00:03.000Z"),
    });
    expect(completed).toMatchObject({
      state: "completed",
      attempt: 1,
      outcome: { summary: "Synthetic completion" },
    });
    expect(
      await createSessionRepository(sql).get(ownerId, submitted.session.id),
    ).toMatchObject({ state: "idle", lastEventSequence: 6 });

    const events = await sql<{ sequence: number; kind: string }[]>`
      select sequence, kind from session_events
      where session_id = ${submitted.session.id}
      order by sequence
    `;
    expect(events).toEqual([
      { sequence: 1, kind: "input_observed" },
      { sequence: 2, kind: "run_queued" },
      { sequence: 3, kind: "run_started" },
      { sequence: 4, kind: "phase_changed" },
      { sequence: 5, kind: "assistant_output_recorded" },
      { sequence: 6, kind: "run_completed" },
    ]);
    const [jobs] = await sql<{ count: number }[]>`
      select count(*)::int as count from runtime_jobs
      where run_id = ${lease.runId}
    `;
    expect(jobs?.count).toBe(0);
    await expect(sql`
      update session_events set payload = '{}'::jsonb
      where session_id = ${submitted.session.id}
    `).rejects.toMatchObject({ code: "55000" });
    await expect(sql`
      delete from session_events where session_id = ${submitted.session.id}
    `).rejects.toMatchObject({ code: "55000" });
    await expect(
      transitions.cancel({
        ownerId,
        sessionId: submitted.session.id,
        runId: lease.runId,
        now: new Date("2030-08-02T04:00:04.000Z"),
      }),
    ).rejects.toMatchObject({ code: "RUN_STATE_CONFLICT" });
  });

  it("pauses, resumes without replaying prior work, and increments attempts", async () => {
    const submitted = await queuedRun("waiting-run");
    const queue = createRuntimeQueueRepository(sql);
    const transitions = createRuntimeTransitionService(sql);
    const lease = await queue.claim({
      workerId: "worker-wait",
      leaseMs: 60_000,
      now: new Date("2030-08-02T05:00:00.000Z"),
    });
    if (lease === null) throw new Error("Expected a lease.");
    await transitions.start({
      runId: lease.runId,
      leaseToken: lease.leaseToken,
      now: new Date("2030-08-02T05:00:00.000Z"),
    });
    const waiting = await transitions.wait({
      runId: lease.runId,
      leaseToken: lease.leaseToken,
      state: "waiting_approval",
      reason: "Synthetic approval boundary",
      now: new Date("2030-08-02T05:00:01.000Z"),
    });
    expect(waiting).toMatchObject({
      state: "waiting_approval",
      waitReason: "Synthetic approval boundary",
    });
    expect(
      await createSessionRepository(sql).get(ownerId, submitted.session.id),
    ).toMatchObject({ state: "waiting_approval" });

    const resumed = await transitions.resume({
      ownerId,
      sessionId: submitted.session.id,
      runId: lease.runId,
      expectedState: "waiting_approval",
      now: new Date("2030-08-02T05:00:02.000Z"),
    });
    expect(resumed).toMatchObject({ state: "queued", attempt: 1 });
    const nextLease = await queue.claim({
      workerId: "worker-resume",
      leaseMs: 60_000,
      now: new Date("2030-08-02T05:00:03.000Z"),
    });
    expect(nextLease).toMatchObject({ runId: lease.runId, attempt: 2 });
    const events = await sql<{ sequence: number; kind: string }[]>`
      select sequence, kind from session_events
      where session_id = ${submitted.session.id}
      order by sequence
    `;
    expect(events.map(({ kind }) => kind)).toEqual([
      "input_observed",
      "run_queued",
      "run_started",
      "run_waiting",
      "run_resumed",
    ]);
  });

  it("cancellation invalidates the worker lease and blocks late output", async () => {
    const submitted = await queuedRun("cancel-run");
    const queue = createRuntimeQueueRepository(sql);
    const transitions = createRuntimeTransitionService(sql);
    const lease = await queue.claim({
      workerId: "worker-cancel",
      leaseMs: 60_000,
      now: new Date("2030-08-02T06:00:00.000Z"),
    });
    if (lease === null) throw new Error("Expected a lease.");
    await transitions.start({
      runId: lease.runId,
      leaseToken: lease.leaseToken,
      now: new Date("2030-08-02T06:00:00.000Z"),
    });
    const cancelled = await transitions.cancel({
      ownerId,
      sessionId: submitted.session.id,
      runId: lease.runId,
      now: new Date("2030-08-02T06:00:01.000Z"),
    });
    expect(cancelled).toMatchObject({ state: "cancelled" });
    await expect(
      transitions.recordAssistantOutput({
        runId: lease.runId,
        leaseToken: lease.leaseToken,
        text: "This late output must never be committed.",
        mentions: [],
        now: new Date("2030-08-02T06:00:02.000Z"),
      }),
    ).rejects.toMatchObject({ code: "LEASE_NOT_FOUND" });
    const [assistantTurns] = await sql<{ count: number }[]>`
      select count(*)::int as count from thread_turns where role = 'assistant'
    `;
    expect(assistantTurns?.count).toBe(0);
  });

  it("records a stable failure outcome and releases the queue lease", async () => {
    const submitted = await queuedRun("failed-run");
    const queue = createRuntimeQueueRepository(sql);
    const transitions = createRuntimeTransitionService(sql);
    const lease = await queue.claim({
      workerId: "worker-fail",
      leaseMs: 60_000,
      now: new Date("2030-08-02T07:00:00.000Z"),
    });
    if (lease === null) throw new Error("Expected a lease.");
    await transitions.start({
      runId: lease.runId,
      leaseToken: lease.leaseToken,
      now: new Date("2030-08-02T07:00:00.000Z"),
    });
    const failed = await transitions.fail({
      runId: lease.runId,
      leaseToken: lease.leaseToken,
      errorCode: "TEST_ADAPTER_FAILURE",
      now: new Date("2030-08-02T07:00:01.000Z"),
    });
    expect(failed).toMatchObject({
      state: "failed",
      errorCode: "TEST_ADAPTER_FAILURE",
    });
    expect(
      await createSessionRepository(sql).get(ownerId, submitted.session.id),
    ).toMatchObject({ state: "failed" });
    const [job] = await sql<{ count: number }[]>`
      select count(*)::int as count from runtime_jobs
      where run_id = ${lease.runId}
    `;
    expect(job?.count).toBe(0);
  });
});
