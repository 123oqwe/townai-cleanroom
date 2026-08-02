import { createHash, randomBytes } from "node:crypto";

import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";

import { asId, idSchema, type Id } from "@town/contracts";

import { RuntimeError } from "./errors.js";
import type { SessionRunState } from "./types.js";

const workerIdSchema = z.string().trim().min(1).max(200);
const leaseTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const leaseMsSchema = z.number().int().min(1_000).max(300_000);

const claimSchema = z
  .object({
    workerId: workerIdSchema,
    leaseMs: leaseMsSchema,
  })
  .strict();

const heartbeatSchema = z
  .object({
    runId: idSchema,
    leaseToken: leaseTokenSchema,
    leaseMs: leaseMsSchema,
  })
  .strict();

const retrySchema = z
  .object({
    runId: idSchema,
    leaseToken: leaseTokenSchema,
    delayMs: z.number().int().min(0).max(86_400_000),
  })
  .strict();

interface CandidateRow {
  owner_id: string;
  session_id: string;
  run_id: string;
  run_state: SessionRunState;
}

export interface RuntimeJobLeaseRow extends CandidateRow {
  state: "queued" | "leased";
  attempt: number;
  lease_token_hash: Buffer | null;
  leased_by: string | null;
  leased_at: Date | null;
  lease_expires_at: Date | null;
  lease_is_current: boolean;
}

export interface RuntimeLease {
  ownerId: Id<"user">;
  sessionId: Id<"runtime-session">;
  runId: Id<"session-run">;
  runState: SessionRunState;
  workerId: string;
  leaseToken: string;
  attempt: number;
  leasedAt: Date;
  leaseExpiresAt: Date;
}

function hashLeaseToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

function assertCurrentLease(
  row: RuntimeJobLeaseRow | undefined,
  tokenHash: Buffer,
): asserts row is RuntimeJobLeaseRow & {
  state: "leased";
  lease_token_hash: Buffer;
  leased_by: string;
  leased_at: Date;
  lease_expires_at: Date;
} {
  if (
    row === undefined ||
    row.state !== "leased" ||
    row.lease_token_hash === null ||
    !row.lease_token_hash.equals(tokenHash) ||
    row.leased_by === null ||
    row.leased_at === null ||
    row.lease_expires_at === null
  ) {
    throw new RuntimeError(
      "LEASE_NOT_FOUND",
      "The runtime lease was not found.",
    );
  }
  if (!row.lease_is_current) {
    throw new RuntimeError("LEASE_EXPIRED", "The runtime lease has expired.");
  }
}

async function lockJob(
  transaction: TransactionSql,
  runId: Id<"session-run">,
): Promise<RuntimeJobLeaseRow | undefined> {
  const [row] = await transaction<RuntimeJobLeaseRow[]>`
    select
      job.owner_id, job.session_id, job.run_id, job.state, job.attempt,
      job.lease_token_hash, job.leased_by, job.leased_at,
      job.lease_expires_at, run.state as run_state,
      coalesce(job.lease_expires_at > clock_timestamp(), false)
        as lease_is_current
    from runtime_jobs job
    join session_runs run
      on run.owner_id = job.owner_id and run.session_id = job.session_id
      and run.id = job.run_id
    where job.run_id = ${runId}
    for update of job
  `;
  return row;
}

export async function verifyRuntimeLeaseInTransaction(
  transaction: TransactionSql,
  input: {
    runId: Id<"session-run">;
    leaseToken: string;
  },
) {
  const runId = asId<"session-run">(input.runId);
  const leaseToken = leaseTokenSchema.parse(input.leaseToken);
  const row = await lockJob(transaction, runId);
  assertCurrentLease(row, hashLeaseToken(leaseToken));
  return row;
}

export function createRuntimeQueueRepository(sql: Sql) {
  async function claim(
    input: z.input<typeof claimSchema>,
  ): Promise<RuntimeLease | null> {
    const value = claimSchema.parse(input);
    const leaseToken = randomBytes(32).toString("base64url");
    const leaseTokenHash = hashLeaseToken(leaseToken);
    return sql.begin(async (transaction) => {
      const [candidate] = await transaction<CandidateRow[]>`
        select
          candidate.owner_id, session.id as session_id, candidate.run_id,
          candidate.run_state
        from runtime_sessions session
        join lateral (
          select
            job.owner_id, job.run_id, job.available_at, job.created_at,
            run.state as run_state
          from runtime_jobs job
          join session_runs run
            on run.owner_id = job.owner_id
            and run.session_id = job.session_id
            and run.id = job.run_id
          where job.owner_id = session.owner_id
            and job.session_id = session.id
            and run.state in ('queued', 'running')
            and job.available_at <= clock_timestamp()
            and (
              job.state = 'queued' or
              (job.state = 'leased'
                and job.lease_expires_at <= clock_timestamp())
            )
          order by job.available_at, job.created_at, job.run_id
          limit 1
        ) candidate on true
        where session.state <> 'cancelled'
          and not exists (
            select 1 from runtime_jobs active
            where active.owner_id = session.owner_id
              and active.session_id = session.id
              and active.state = 'leased'
              and active.lease_expires_at > clock_timestamp()
          )
        order by candidate.available_at, candidate.created_at, candidate.run_id
        for update of session skip locked
        limit 1
      `;
      if (candidate === undefined) return null;

      const [claimed] = await transaction<
        {
          attempt: number;
          leased_at: Date;
          lease_expires_at: Date;
        }[]
      >`
        update runtime_jobs
        set state = 'leased', attempt = attempt + 1,
            lease_token_hash = ${leaseTokenHash}, leased_by = ${value.workerId},
            leased_at = clock_timestamp(),
            lease_expires_at = clock_timestamp()
              + ${value.leaseMs} * interval '1 millisecond',
            updated_at = clock_timestamp()
        where owner_id = ${candidate.owner_id}
          and session_id = ${candidate.session_id}
          and run_id = ${candidate.run_id}
          and available_at <= clock_timestamp()
          and (
            state = 'queued' or
            (state = 'leased' and lease_expires_at <= clock_timestamp())
          )
        returning attempt, leased_at, lease_expires_at
      `;
      if (claimed === undefined) return null;
      if (candidate.run_state === "running") {
        await transaction`
          update session_runs
          set attempt = ${claimed.attempt}, updated_at = clock_timestamp()
          where owner_id = ${candidate.owner_id}
            and session_id = ${candidate.session_id}
            and id = ${candidate.run_id} and state = 'running'
        `;
      }
      return {
        ownerId: asId<"user">(candidate.owner_id),
        sessionId: asId<"runtime-session">(candidate.session_id),
        runId: asId<"session-run">(candidate.run_id),
        runState: candidate.run_state,
        workerId: value.workerId,
        leaseToken,
        attempt: claimed.attempt,
        leasedAt: claimed.leased_at,
        leaseExpiresAt: claimed.lease_expires_at,
      };
    });
  }

  async function heartbeat(
    input: z.input<typeof heartbeatSchema>,
  ): Promise<RuntimeLease> {
    const value = heartbeatSchema.parse(input);
    const runId = asId<"session-run">(value.runId);
    const tokenHash = hashLeaseToken(value.leaseToken);
    return sql.begin(async (transaction) => {
      const row = await lockJob(transaction, runId);
      assertCurrentLease(row, tokenHash);
      const [updated] = await transaction<
        {
          lease_expires_at: Date;
        }[]
      >`
        update runtime_jobs
        set lease_expires_at = clock_timestamp()
              + ${value.leaseMs} * interval '1 millisecond',
            updated_at = clock_timestamp()
        where run_id = ${runId}
        returning lease_expires_at
      `;
      if (updated === undefined)
        throw new Error("Lease heartbeat returned no row.");
      return {
        ownerId: asId<"user">(row.owner_id),
        sessionId: asId<"runtime-session">(row.session_id),
        runId,
        runState: row.run_state,
        workerId: row.leased_by,
        leaseToken: value.leaseToken,
        attempt: row.attempt,
        leasedAt: row.leased_at,
        leaseExpiresAt: updated.lease_expires_at,
      };
    });
  }

  async function retry(input: z.input<typeof retrySchema>): Promise<void> {
    const value = retrySchema.parse(input);
    const runId = asId<"session-run">(value.runId);
    const tokenHash = hashLeaseToken(value.leaseToken);
    await sql.begin(async (transaction) => {
      const row = await lockJob(transaction, runId);
      assertCurrentLease(row, tokenHash);
      await transaction`
        update runtime_jobs set state = 'queued',
            available_at = clock_timestamp()
              + ${value.delayMs} * interval '1 millisecond',
            lease_token_hash = null, leased_by = null, leased_at = null,
            lease_expires_at = null, updated_at = clock_timestamp()
        where run_id = ${runId}
      `;
    });
  }

  return { claim, heartbeat, retry };
}

export type RuntimeQueueRepository = ReturnType<
  typeof createRuntimeQueueRepository
>;
