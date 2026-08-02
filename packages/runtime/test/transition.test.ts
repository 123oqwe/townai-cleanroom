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
    const lease = await queue.claim({
      workerId: "worker-complete",
      leaseMs: 60_000,
    });
    if (lease === null) throw new Error("Expected a lease.");

    await transitions.start({
      runId: lease.runId,
      leaseToken: lease.leaseToken,
    });
    await transitions.recordPhase({
      runId: lease.runId,
      leaseToken: lease.leaseToken,
      phase: "model_running",
    });
    const output = await transitions.recordAssistantOutput({
      runId: lease.runId,
      leaseToken: lease.leaseToken,
      text: "Explicit deterministic adapter output.",
      mentions: [],
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
    });
    if (lease === null) throw new Error("Expected a lease.");
    await transitions.start({
      runId: lease.runId,
      leaseToken: lease.leaseToken,
    });
    const waiting = await transitions.wait({
      runId: lease.runId,
      leaseToken: lease.leaseToken,
      state: "waiting_approval",
      reason: "Synthetic approval boundary",
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
    });
    expect(resumed).toMatchObject({ state: "queued", attempt: 1 });
    const nextLease = await queue.claim({
      workerId: "worker-resume",
      leaseMs: 60_000,
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
    });
    if (lease === null) throw new Error("Expected a lease.");
    await transitions.start({
      runId: lease.runId,
      leaseToken: lease.leaseToken,
    });
    const cancelled = await transitions.cancel({
      ownerId,
      sessionId: submitted.session.id,
      runId: lease.runId,
    });
    expect(cancelled).toMatchObject({ state: "cancelled" });
    await expect(
      transitions.recordAssistantOutput({
        runId: lease.runId,
        leaseToken: lease.leaseToken,
        text: "This late output must never be committed.",
        mentions: [],
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
    });
    if (lease === null) throw new Error("Expected a lease.");
    await transitions.start({
      runId: lease.runId,
      leaseToken: lease.leaseToken,
    });
    const failed = await transitions.fail({
      runId: lease.runId,
      leaseToken: lease.leaseToken,
      errorCode: "TEST_ADAPTER_FAILURE",
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

    const retried = await createSessionRepository(sql).submitMessage({
      ownerId,
      threadId: submitted.turn.threadId,
      idempotencyKey: "queued-after-failure",
      text: "Queue fresh work after the prior Run failed.",
      mentions: [],
    });
    expect(retried).toMatchObject({
      session: { state: "idle" },
      run: { state: "queued" },
    });
  });

  it("reclaims an expired lease after start without losing Run progress", async () => {
    await queuedRun("reclaim-running-run");
    const queue = createRuntimeQueueRepository(sql);
    const transitions = createRuntimeTransitionService(sql);
    const lease = await queue.claim({
      workerId: "worker-before-crash",
      leaseMs: 10_000,
    });
    if (lease === null) throw new Error("Expected a lease.");
    await transitions.start({
      runId: lease.runId,
      leaseToken: lease.leaseToken,
    });

    await sql`
      update runtime_jobs
      set leased_at = clock_timestamp() - interval '2 seconds',
          lease_expires_at = clock_timestamp() - interval '1 second'
      where run_id = ${lease.runId}
    `;

    const reclaimed = await queue.claim({
      workerId: "worker-after-crash",
      leaseMs: 60_000,
    });
    expect(reclaimed).toMatchObject({
      runId: lease.runId,
      runState: "running",
      attempt: 2,
    });
    if (reclaimed === null) throw new Error("Expected a reclaimed lease.");
    await expect(
      createSessionRepository(sql).getRun(
        reclaimed.ownerId,
        reclaimed.sessionId,
        reclaimed.runId,
      ),
    ).resolves.toMatchObject({ state: "running", attempt: 2 });
    await expect(
      transitions.recordAssistantOutput({
        runId: lease.runId,
        leaseToken: lease.leaseToken,
        text: "The expired worker must not commit.",
        mentions: [],
      }),
    ).rejects.toMatchObject({ code: "LEASE_NOT_FOUND" });
    await expect(
      transitions.recordAssistantOutput({
        runId: reclaimed.runId,
        leaseToken: reclaimed.leaseToken,
        text: "The replacement worker owns this output.",
        mentions: [],
      }),
    ).resolves.toMatchObject({
      sourceRef: lease.runId,
      text: "The replacement worker owns this output.",
    });
  });

  it("derives Session state when cancelling or resuming a non-current Run", async () => {
    const first = await queuedRun("session-state-first");
    const sessions = createSessionRepository(sql);
    const queue = createRuntimeQueueRepository(sql);
    const transitions = createRuntimeTransitionService(sql);
    const firstLease = await queue.claim({
      workerId: "worker-current-a",
      leaseMs: 60_000,
    });
    if (firstLease === null) throw new Error("Expected the first lease.");
    await transitions.start({
      runId: firstLease.runId,
      leaseToken: firstLease.leaseToken,
    });

    const second = await sessions.submitMessage({
      ownerId,
      threadId: first.turn.threadId,
      idempotencyKey: "session-state-second",
      text: "Queue a non-current Run for cancellation.",
      mentions: [],
    });
    await transitions.cancel({
      ownerId,
      sessionId: second.session.id,
      runId: second.run.id,
    });
    await expect(
      sessions.get(ownerId, first.session.id),
    ).resolves.toMatchObject({ state: "running" });

    await transitions.wait({
      runId: firstLease.runId,
      leaseToken: firstLease.leaseToken,
      state: "waiting_approval",
      reason: "Pause the first Run while another starts.",
    });
    const third = await sessions.submitMessage({
      ownerId,
      threadId: first.turn.threadId,
      idempotencyKey: "session-state-third",
      text: "Run while the first Run is waiting.",
      mentions: [],
    });
    const thirdLease = await queue.claim({
      workerId: "worker-current-c",
      leaseMs: 60_000,
    });
    expect(thirdLease?.runId).toBe(third.run.id);
    if (thirdLease === null) throw new Error("Expected the third lease.");
    await transitions.start({
      runId: thirdLease.runId,
      leaseToken: thirdLease.leaseToken,
    });
    await transitions.resume({
      ownerId,
      sessionId: first.session.id,
      runId: first.run.id,
      expectedState: "waiting_approval",
    });
    await expect(
      sessions.get(ownerId, first.session.id),
    ).resolves.toMatchObject({ state: "running" });
  });

  it("serializes concurrent completion and cancellation before deriving Session state", async () => {
    const first = await queuedRun("concurrent-state-first");
    const sessions = createSessionRepository(sql);
    const queue = createRuntimeQueueRepository(sql);
    const transitions = createRuntimeTransitionService(sql);
    const lease = await queue.claim({
      workerId: "worker-concurrent-state",
      leaseMs: 60_000,
    });
    if (lease === null) throw new Error("Expected a lease.");
    await transitions.start({
      runId: lease.runId,
      leaseToken: lease.leaseToken,
    });
    const second = await sessions.submitMessage({
      ownerId,
      threadId: first.turn.threadId,
      idempotencyKey: "concurrent-state-second",
      text: "Cancel concurrently with the active Run completion.",
      mentions: [],
    });

    await expect(
      Promise.all([
        transitions.complete({
          runId: lease.runId,
          leaseToken: lease.leaseToken,
          outcome: { summary: "Concurrent completion" },
        }),
        transitions.cancel({
          ownerId,
          sessionId: second.session.id,
          runId: second.run.id,
        }),
      ]),
    ).resolves.toHaveLength(2);
    await expect(
      sessions.get(ownerId, first.session.id),
    ).resolves.toMatchObject({ state: "idle" });
  });

  it("does not deadlock concurrent cancellation and worker output", async () => {
    const submitted = await queuedRun("concurrent-cancel-output");
    const queue = createRuntimeQueueRepository(sql);
    const transitions = createRuntimeTransitionService(sql);
    const lease = await queue.claim({
      workerId: "worker-concurrent-cancel",
      leaseMs: 60_000,
    });
    if (lease === null) throw new Error("Expected a lease.");
    await transitions.start({
      runId: lease.runId,
      leaseToken: lease.leaseToken,
    });

    const results = await Promise.allSettled([
      transitions.cancel({
        ownerId,
        sessionId: submitted.session.id,
        runId: submitted.run.id,
      }),
      transitions.recordAssistantOutput({
        runId: lease.runId,
        leaseToken: lease.leaseToken,
        text: "Output racing with explicit cancellation.",
        mentions: [],
      }),
    ]);
    expect(results[0]?.status).toBe("fulfilled");
    const outputResult = results[1];
    if (outputResult?.status === "rejected") {
      expect(outputResult.reason).toMatchObject({ code: "LEASE_NOT_FOUND" });
      expect(outputResult.reason).not.toMatchObject({ code: "40P01" });
    }
  });
});
