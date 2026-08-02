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

let sql: Sql;
let ownerId: Id<"user">;

beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 12 });
  await runMigrations(sql);
});

beforeEach(async () => {
  await sql`truncate table users cascade`;
  ownerId = newId<"user">();
  await sql`
    insert into users (id, email, timezone)
    values (${ownerId}, 'queue-owner@example.invalid', 'UTC')
  `;
});

afterAll(async () => {
  await sql.end();
});

async function createThreadFixture(title: string) {
  let agent;
  try {
    agent = await createAgentRepository(sql).getPersonal(ownerId);
  } catch {
    agent = await createAgentRepository(sql).createPersonal({
      ownerId,
      displayName: "Queue Test Assistant",
      instructions: "Use only synthetic queue fixtures.",
      defaultApprovalMode: "require_approval",
    });
  }
  return createThreadRepository(sql).createAssistant({
    ownerId,
    agentId: agent.id,
    title,
    approvalMode: "require_approval",
  });
}

async function submit(threadId: Id<"thread">, key: string, text = key) {
  return createSessionRepository(sql).submitMessage({
    ownerId,
    threadId,
    idempotencyKey: key,
    text,
    mentions: [],
  });
}

describe("runtime queue leases", () => {
  it("claims FIFO work while serializing Runs within one Session", async () => {
    const firstThread = await createThreadFixture("First Session");
    const first = await submit(firstThread.id, "first-run");
    const second = await submit(firstThread.id, "second-run");
    const secondThread = await createThreadFixture("Second Session");
    const otherSession = await submit(secondThread.id, "other-session-run");
    await sql`
      update runtime_jobs set created_at = case run_id
        when ${first.run.id} then '2026-08-02T00:00:01Z'::timestamptz
        when ${second.run.id} then '2026-08-02T00:00:02Z'::timestamptz
        else '2026-08-02T00:00:03Z'::timestamptz
      end
    `;
    const queue = createRuntimeQueueRepository(sql);
    const lease1 = await queue.claim({
      workerId: "worker-a",
      leaseMs: 60_000,
    });
    expect(lease1).toMatchObject({
      runId: first.run.id,
      sessionId: first.session.id,
      workerId: "worker-a",
      attempt: 1,
    });
    expect(lease1?.leaseToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const lease2 = await queue.claim({
      workerId: "worker-b",
      leaseMs: 60_000,
    });
    expect(lease2).toMatchObject({
      runId: otherSession.run.id,
      sessionId: otherSession.session.id,
    });
    const noParallelSameSession = await queue.claim({
      workerId: "worker-c",
      leaseMs: 60_000,
    });
    expect(noParallelSameSession).toBeNull();

    const [stored] = await sql<
      {
        lease_token_hash: Buffer;
        leased_by: string;
      }[]
    >`
      select lease_token_hash, leased_by from runtime_jobs
      where run_id = ${first.run.id}
    `;
    expect(stored?.lease_token_hash).toHaveLength(32);
    expect(stored?.lease_token_hash.toString("utf8")).not.toBe(
      lease1?.leaseToken,
    );
    expect(stored?.leased_by).toBe("worker-a");
  });

  it("heartbeats, retries after availability, and rejects expired or stale tokens", async () => {
    const thread = await createThreadFixture("Lease lifecycle");
    const submission = await submit(thread.id, "lease-lifecycle");
    const queue = createRuntimeQueueRepository(sql);
    const lease = await queue.claim({
      workerId: "worker-lifecycle",
      leaseMs: 10_000,
    });
    expect(lease?.runId).toBe(submission.run.id);
    if (lease === null) throw new Error("Expected a lease.");

    const heartbeat = await queue.heartbeat({
      runId: lease.runId,
      leaseToken: lease.leaseToken,
      leaseMs: 20_000,
    });
    expect(heartbeat.leaseExpiresAt.getTime()).toBeGreaterThan(
      lease.leaseExpiresAt.getTime(),
    );
    await expect(
      queue.claim({
        workerId: "worker-must-respect-heartbeat",
        leaseMs: 10_000,
      }),
    ).resolves.toBeNull();
    await expect(
      queue.heartbeat({
        runId: lease.runId,
        leaseToken: "A".repeat(43),
        leaseMs: 20_000,
      }),
    ).rejects.toMatchObject({ code: "LEASE_NOT_FOUND" });

    await queue.retry({
      runId: lease.runId,
      leaseToken: lease.leaseToken,
      delayMs: 30_000,
    });
    expect(
      await queue.claim({
        workerId: "worker-too-early",
        leaseMs: 10_000,
      }),
    ).toBeNull();
    await sql`
      update runtime_jobs
      set available_at = clock_timestamp() - interval '1 second'
      where run_id = ${lease.runId}
    `;
    const reclaimed = await queue.claim({
      workerId: "worker-retry",
      leaseMs: 10_000,
    });
    expect(reclaimed).toMatchObject({ runId: lease.runId, attempt: 2 });
    await expect(
      queue.heartbeat({
        runId: lease.runId,
        leaseToken: lease.leaseToken,
        leaseMs: 10_000,
      }),
    ).rejects.toMatchObject({ code: "LEASE_NOT_FOUND" });
    if (reclaimed === null) throw new Error("Expected a reclaimed lease.");
    await sql`
      update runtime_jobs
      set leased_at = clock_timestamp() - interval '2 seconds',
          lease_expires_at = clock_timestamp() - interval '1 second'
      where run_id = ${reclaimed.runId}
    `;
    await expect(
      queue.heartbeat({
        runId: reclaimed.runId,
        leaseToken: reclaimed.leaseToken,
        leaseMs: 10_000,
      }),
    ).rejects.toMatchObject({ code: "LEASE_EXPIRED" });
    await expect(
      queue.heartbeat({
        runId: reclaimed.runId,
        leaseToken: reclaimed.leaseToken,
        leaseMs: 10_000,
        now: new Date("2000-01-01T00:00:00.000Z"),
      } as never),
    ).rejects.toMatchObject({ name: "ZodError" });
  });

  it("allows only one concurrent worker to claim a single job", async () => {
    const thread = await createThreadFixture("Concurrent claim");
    const submission = await submit(thread.id, "one-claim");
    const queue = createRuntimeQueueRepository(sql);
    const claims = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        queue.claim({
          workerId: `worker-${index}`,
          leaseMs: 60_000,
        }),
      ),
    );
    const leases = claims.filter((claim) => claim !== null);
    expect(leases).toHaveLength(1);
    expect(leases[0]?.runId).toBe(submission.run.id);
  });
});
