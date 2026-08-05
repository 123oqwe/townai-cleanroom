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
    values (${ownerId}, 'cross-proc-owner@example.invalid', 'UTC')
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
      displayName: "Cross-Process Test Assistant",
      instructions: "Use only synthetic lease fixtures.",
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

/**
 * Simulates two independent worker processes by creating two separate
 * connection pools (postgres.Sql instances). Each pool has its own
 * transaction lifecycle, exactly like two `apps/worker` processes on
 * different hosts. The database-level lease mechanism (FOR UPDATE SKIP
 * LOCKED) is the only coordination layer.
 */
describe("cross-process lease concurrency", () => {
  it("only one of two independent connection pools claims a single run", async () => {
    const poolA = postgres(inject("postgresUrl"), { max: 4 });
    const poolB = postgres(inject("postgresUrl"), { max: 4 });
    try {
      const queueA = createRuntimeQueueRepository(poolA);
      const queueB = createRuntimeQueueRepository(poolB);

      const thread = await createThreadFixture("Cross-Process Race");
      const submission = await submit(thread.id, "cross-proc-run");

      const [claimA, claimB] = await Promise.all([
        queueA.claim({ workerId: "worker-process-a", leaseMs: 60_000 }),
        queueB.claim({ workerId: "worker-process-b", leaseMs: 60_000 }),
      ]);

      const leases = [claimA, claimB].filter((c) => c !== null);
      expect(leases).toHaveLength(1);
      expect(leases[0]?.runId).toBe(submission.run.id);

      const winner = claimA !== null ? "A" : "B";
      const loser = winner === "A" ? claimB : claimA;
      expect(loser).toBeNull();

      const [stored] = await sql<{ leased_by: string; state: string }[]>`
        select leased_by, state from runtime_jobs
        where run_id = ${submission.run.id}
      `;
      expect(stored?.state).toBe("leased");
      expect(stored?.leased_by).toBe(
        winner === "A" ? "worker-process-a" : "worker-process-b",
      );
    } finally {
      await poolA.end();
      await poolB.end();
    }
  });

  it("second worker reclaims after first worker's lease expires", async () => {
    const poolA = postgres(inject("postgresUrl"), { max: 4 });
    const poolB = postgres(inject("postgresUrl"), { max: 4 });
    try {
      const queueA = createRuntimeQueueRepository(poolA);
      const queueB = createRuntimeQueueRepository(poolB);

      const thread = await createThreadFixture("Lease Expiry Race");
      const submission = await submit(thread.id, "expiry-run");

      // Worker A claims with a short lease.
      const claimA = await queueA.claim({
        workerId: "worker-a-short-lease",
        leaseMs: 1_000,
      });
      expect(claimA).not.toBeNull();
      expect(claimA?.runId).toBe(submission.run.id);

      // Worker B cannot claim while A's lease is current.
      const blockedClaim = await queueB.claim({
        workerId: "worker-b-while-leased",
        leaseMs: 60_000,
      });
      expect(blockedClaim).toBeNull();

      // Force the lease to expire by backdating.
      await sql`
        update runtime_jobs
        set leased_at = clock_timestamp() - interval '2 seconds',
          lease_expires_at = clock_timestamp() - interval '1 second'
        where run_id = ${submission.run.id}
      `;

      // Worker B can now reclaim the expired lease.
      const claimB = await queueB.claim({
        workerId: "worker-b-after-expiry",
        leaseMs: 60_000,
      });
      expect(claimB).not.toBeNull();
      expect(claimB?.runId).toBe(submission.run.id);
      expect(claimB?.attempt).toBe(2);

      // Worker A's old lease token is now invalid — worker B replaced it.
      if (claimA === null) throw new Error("Expected claimA");
      await expect(
        queueA.heartbeat({
          runId: claimA.runId,
          leaseToken: claimA.leaseToken,
          leaseMs: 10_000,
        }),
      ).rejects.toMatchObject({ code: "LEASE_NOT_FOUND" });
    } finally {
      await poolA.end();
      await poolB.end();
    }
  });

  it("two workers process two independent runs without interference", async () => {
    const poolA = postgres(inject("postgresUrl"), { max: 4 });
    const poolB = postgres(inject("postgresUrl"), { max: 4 });
    try {
      const queueA = createRuntimeQueueRepository(poolA);
      const queueB = createRuntimeQueueRepository(poolB);

      const thread1 = await createThreadFixture("Independent Run 1");
      const thread2 = await createThreadFixture("Independent Run 2");
      const sub1 = await submit(thread1.id, "independent-1");
      const sub2 = await submit(thread2.id, "independent-2");

      const [claimA, claimB] = await Promise.all([
        queueA.claim({ workerId: "worker-a", leaseMs: 60_000 }),
        queueB.claim({ workerId: "worker-b", leaseMs: 60_000 }),
      ]);

      expect(claimA).not.toBeNull();
      expect(claimB).not.toBeNull();
      expect(claimA?.runId).not.toBe(claimB?.runId);

      const runIds = new Set([claimA?.runId, claimB?.runId]);
      expect(runIds.has(sub1.run.id)).toBe(true);
      expect(runIds.has(sub2.run.id)).toBe(true);
    } finally {
      await poolA.end();
      await poolB.end();
    }
  });
});
