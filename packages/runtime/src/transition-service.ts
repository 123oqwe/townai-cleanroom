import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";

import {
  appendTurnInTransaction,
  turnMentionsInputSchema,
  type ThreadTurn,
} from "@town/agents";
import { asId, idSchema, newId, type Id } from "@town/contracts";

import { RuntimeError } from "./errors.js";
import {
  lockRuntimeJobInTransaction,
  lockRuntimeSessionInTransaction,
  verifyRuntimeLeaseInTransaction,
} from "./queue-repository.js";
import { createSessionRepository } from "./session-repository.js";
import { deriveRuntimeSessionStateInTransaction } from "./session-state.js";
import {
  runtimePayloadSchema,
  sessionEventKindSchema,
  type RuntimePayload,
  type RuntimeSessionState,
  type SessionEventKind,
  type SessionRun,
  type SessionRunState,
} from "./types.js";

const leasedRunSchema = z
  .object({
    runId: idSchema,
    leaseToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();

const phaseSchema = z.enum([
  "context_building",
  "model_running",
  "policy_check",
  "observation_recorded",
]);

const recordPhaseSchema = leasedRunSchema
  .extend({ phase: phaseSchema })
  .strict();
const recordOutputSchema = leasedRunSchema
  .extend({
    text: z.string().trim().min(1).max(100_000),
    mentions: turnMentionsInputSchema,
  })
  .strict();
const completeSchema = leasedRunSchema
  .extend({ outcome: runtimePayloadSchema })
  .strict();
const failSchema = leasedRunSchema
  .extend({ errorCode: z.string().trim().min(1).max(200) })
  .strict();
const waitSchema = leasedRunSchema
  .extend({
    state: z.enum(["waiting_approval", "waiting_user_input"]),
    reason: z.string().trim().min(1).max(2_000),
    approvalId: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
const resumeSchema = z
  .object({
    ownerId: idSchema,
    sessionId: idSchema,
    runId: idSchema,
    expectedState: z.enum(["waiting_approval", "waiting_user_input"]),
  })
  .strict();
const cancelSchema = z
  .object({
    ownerId: idSchema,
    sessionId: idSchema,
    runId: idSchema,
  })
  .strict();

interface LockedRunRow {
  id: string;
  owner_id: string;
  session_id: string;
  thread_id: string;
  state: SessionRunState;
  attempt: number;
}

async function lockRun(
  transaction: TransactionSql,
  input: {
    ownerId: string;
    sessionId: string;
    runId: string;
  },
): Promise<LockedRunRow> {
  const [run] = await transaction<LockedRunRow[]>`
    select id, owner_id, session_id, thread_id, state, attempt
    from session_runs
    where owner_id = ${input.ownerId} and session_id = ${input.sessionId}
      and id = ${input.runId}
    for update
  `;
  if (run === undefined) {
    throw new RuntimeError("RUN_NOT_FOUND", "The Run was not found.");
  }
  return run;
}

function requireState(run: LockedRunRow, ...states: SessionRunState[]): void {
  if (!states.includes(run.state)) {
    throw new RuntimeError(
      "RUN_STATE_CONFLICT",
      "The Run is not in a state that permits this transition.",
    );
  }
}

async function appendEvent(
  transaction: TransactionSql,
  input: {
    ownerId: string;
    sessionId: string;
    runId: string;
    kind: SessionEventKind;
    payload: RuntimePayload;
    sessionState?: RuntimeSessionState;
  },
): Promise<void> {
  const kind = sessionEventKindSchema.parse(input.kind);
  const payload = runtimePayloadSchema.parse(input.payload);
  const rows =
    input.sessionState === undefined
      ? await transaction<{ last_event_sequence: number }[]>`
          update runtime_sessions
          set last_event_sequence = last_event_sequence + 1,
              revision = revision + 1, updated_at = now()
          where owner_id = ${input.ownerId} and id = ${input.sessionId}
          returning last_event_sequence
        `
      : await transaction<{ last_event_sequence: number }[]>`
          update runtime_sessions
          set state = ${input.sessionState},
              last_event_sequence = last_event_sequence + 1,
              revision = revision + 1, updated_at = now()
          where owner_id = ${input.ownerId} and id = ${input.sessionId}
          returning last_event_sequence
        `;
  const sequence = rows[0]?.last_event_sequence;
  if (sequence === undefined) {
    throw new RuntimeError("SESSION_NOT_FOUND", "The Session was not found.");
  }
  await transaction`
    insert into session_events (
      id, owner_id, session_id, run_id, sequence, kind, payload
    ) values (
      ${newId<"session-event">()}, ${input.ownerId}, ${input.sessionId},
      ${input.runId}, ${sequence}, ${kind}, ${transaction.json(payload)}
    )
  `;
}

export function createRuntimeTransitionService(sql: Sql) {
  const sessions = createSessionRepository(sql);

  async function start(
    input: z.input<typeof leasedRunSchema>,
  ): Promise<SessionRun> {
    const value = leasedRunSchema.parse(input);
    const runId = asId<"session-run">(value.runId);
    const lease = await sql.begin(async (transaction) => {
      const current = await verifyRuntimeLeaseInTransaction(transaction, {
        runId,
        leaseToken: value.leaseToken,
      });
      const run = await lockRun(transaction, {
        ownerId: current.owner_id,
        sessionId: current.session_id,
        runId,
      });
      requireState(run, "queued");
      await transaction`
        update session_runs
        set state = 'running', attempt = ${current.attempt},
            started_at = clock_timestamp(), updated_at = clock_timestamp()
        where id = ${runId}
      `;
      await appendEvent(transaction, {
        ownerId: current.owner_id,
        sessionId: current.session_id,
        runId,
        kind: "run_started",
        payload: { attempt: current.attempt, workerId: current.leased_by },
        sessionState: await deriveRuntimeSessionStateInTransaction(
          transaction,
          current.owner_id,
          current.session_id,
        ),
      });
      return current;
    });
    return sessions.getRun(
      asId<"user">(lease.owner_id),
      asId<"runtime-session">(lease.session_id),
      runId,
    );
  }

  async function recordPhase(
    input: z.input<typeof recordPhaseSchema>,
  ): Promise<void> {
    const value = recordPhaseSchema.parse(input);
    const runId = asId<"session-run">(value.runId);
    await sql.begin(async (transaction) => {
      const lease = await verifyRuntimeLeaseInTransaction(transaction, {
        runId,
        leaseToken: value.leaseToken,
      });
      const run = await lockRun(transaction, {
        ownerId: lease.owner_id,
        sessionId: lease.session_id,
        runId,
      });
      requireState(run, "running");
      await appendEvent(transaction, {
        ownerId: run.owner_id,
        sessionId: run.session_id,
        runId,
        kind: "phase_changed",
        payload: { phase: value.phase },
      });
    });
  }

  async function recordAssistantOutput(
    input: z.input<typeof recordOutputSchema>,
  ): Promise<ThreadTurn> {
    const value = recordOutputSchema.parse(input);
    const runId = asId<"session-run">(value.runId);
    return sql.begin(async (transaction) => {
      const lease = await verifyRuntimeLeaseInTransaction(transaction, {
        runId,
        leaseToken: value.leaseToken,
      });
      const run = await lockRun(transaction, {
        ownerId: lease.owner_id,
        sessionId: lease.session_id,
        runId,
      });
      requireState(run, "running");
      const turn = await appendTurnInTransaction(transaction, {
        ownerId: asId<"user">(run.owner_id),
        threadId: asId<"thread">(run.thread_id),
        role: "assistant",
        text: value.text,
        sourceType: "runtime",
        sourceRef: runId,
        mentions: value.mentions,
      });
      await appendEvent(transaction, {
        ownerId: run.owner_id,
        sessionId: run.session_id,
        runId,
        kind: "assistant_output_recorded",
        payload: { turnId: turn.id, turnSequence: turn.sequence },
      });
      return turn;
    });
  }

  async function finishWithLease(input: {
    runId: Id<"session-run">;
    leaseToken: string;
    state: "completed" | "failed";
    outcome?: RuntimePayload;
    errorCode?: string;
  }): Promise<SessionRun> {
    if (input.state === "failed" && input.errorCode === undefined) {
      throw new Error("Failed Runs require an error code.");
    }
    const result = await sql.begin(async (transaction) => {
      const lease = await verifyRuntimeLeaseInTransaction(transaction, input);
      const run = await lockRun(transaction, {
        ownerId: lease.owner_id,
        sessionId: lease.session_id,
        runId: input.runId,
      });
      requireState(run, "running");
      await transaction`
        update session_runs
        set state = ${input.state}, outcome = ${
          input.outcome === undefined ? null : transaction.json(input.outcome)
        }, error_code = ${input.errorCode ?? null},
            finished_at = clock_timestamp(), updated_at = clock_timestamp()
        where id = ${input.runId}
      `;
      await transaction`
        delete from runtime_jobs where run_id = ${input.runId}
      `;
      await appendEvent(transaction, {
        ownerId: run.owner_id,
        sessionId: run.session_id,
        runId: input.runId,
        kind: input.state === "completed" ? "run_completed" : "run_failed",
        payload:
          input.state === "completed"
            ? { outcome: input.outcome ?? {} }
            : { errorCode: input.errorCode ?? "UNKNOWN_RUNTIME_FAILURE" },
        sessionState: await deriveRuntimeSessionStateInTransaction(
          transaction,
          run.owner_id,
          run.session_id,
        ),
      });
      return run;
    });
    return sessions.getRun(
      asId<"user">(result.owner_id),
      asId<"runtime-session">(result.session_id),
      input.runId,
    );
  }

  function complete(
    input: z.input<typeof completeSchema>,
  ): Promise<SessionRun> {
    const value = completeSchema.parse(input);
    return finishWithLease({
      runId: asId<"session-run">(value.runId),
      leaseToken: value.leaseToken,
      state: "completed",
      outcome: value.outcome,
    });
  }

  function fail(input: z.input<typeof failSchema>): Promise<SessionRun> {
    const value = failSchema.parse(input);
    return finishWithLease({
      runId: asId<"session-run">(value.runId),
      leaseToken: value.leaseToken,
      state: "failed",
      errorCode: value.errorCode,
    });
  }

  async function wait(input: z.input<typeof waitSchema>): Promise<SessionRun> {
    const value = waitSchema.parse(input);
    const runId = asId<"session-run">(value.runId);
    const result = await sql.begin(async (transaction) => {
      const lease = await verifyRuntimeLeaseInTransaction(transaction, {
        runId,
        leaseToken: value.leaseToken,
      });
      const run = await lockRun(transaction, {
        ownerId: lease.owner_id,
        sessionId: lease.session_id,
        runId,
      });
      requireState(run, "running");
      await transaction`
        update session_runs
        set state = ${value.state}, wait_reason = ${value.reason},
            updated_at = clock_timestamp()
        where id = ${runId}
      `;
      await transaction`delete from runtime_jobs where run_id = ${runId}`;
      await appendEvent(transaction, {
        ownerId: run.owner_id,
        sessionId: run.session_id,
        runId,
        kind: "run_waiting",
        payload: {
          state: value.state,
          reason: value.reason,
          ...(value.approvalId === undefined
            ? {}
            : { approvalId: value.approvalId }),
        },
        sessionState: await deriveRuntimeSessionStateInTransaction(
          transaction,
          run.owner_id,
          run.session_id,
        ),
      });
      return run;
    });
    return sessions.getRun(
      asId<"user">(result.owner_id),
      asId<"runtime-session">(result.session_id),
      runId,
    );
  }

  async function resume(
    input: z.input<typeof resumeSchema>,
  ): Promise<SessionRun> {
    const value = resumeSchema.parse(input);
    const ownerId = asId<"user">(value.ownerId);
    const sessionId = asId<"runtime-session">(value.sessionId);
    const runId = asId<"session-run">(value.runId);
    await sql.begin(async (transaction) => {
      await lockRuntimeSessionInTransaction(transaction, ownerId, sessionId);
      const run = await lockRun(transaction, { ownerId, sessionId, runId });
      requireState(run, value.expectedState);
      await transaction`
        update session_runs
        set state = 'queued', wait_reason = null, started_at = null,
            finished_at = null, outcome = null, error_code = null,
            updated_at = clock_timestamp()
        where id = ${runId}
      `;
      await transaction`
        insert into runtime_jobs (
          run_id, owner_id, session_id, attempt, available_at,
          created_at, updated_at
        ) values (
          ${runId}, ${ownerId}, ${sessionId}, ${run.attempt},
          clock_timestamp(), clock_timestamp(), clock_timestamp()
        )
      `;
      await appendEvent(transaction, {
        ownerId,
        sessionId,
        runId,
        kind: "run_resumed",
        payload: { previousState: value.expectedState },
        sessionState: await deriveRuntimeSessionStateInTransaction(
          transaction,
          ownerId,
          sessionId,
        ),
      });
    });
    return sessions.getRun(ownerId, sessionId, runId);
  }

  async function cancel(
    input: z.input<typeof cancelSchema>,
  ): Promise<SessionRun> {
    const value = cancelSchema.parse(input);
    const ownerId = asId<"user">(value.ownerId);
    const sessionId = asId<"runtime-session">(value.sessionId);
    const runId = asId<"session-run">(value.runId);
    await sql.begin(async (transaction) => {
      await lockRuntimeSessionInTransaction(transaction, ownerId, sessionId);
      await lockRuntimeJobInTransaction(transaction, ownerId, sessionId, runId);
      const run = await lockRun(transaction, { ownerId, sessionId, runId });
      requireState(
        run,
        "queued",
        "running",
        "waiting_approval",
        "waiting_user_input",
      );
      await transaction`delete from runtime_jobs where run_id = ${runId}`;
      await transaction`
        update session_runs
        set state = 'cancelled', wait_reason = null, outcome = null,
            error_code = null, finished_at = clock_timestamp(),
            updated_at = clock_timestamp()
        where id = ${runId}
      `;
      await appendEvent(transaction, {
        ownerId,
        sessionId,
        runId,
        kind: "run_cancelled",
        payload: { previousState: run.state },
        sessionState: await deriveRuntimeSessionStateInTransaction(
          transaction,
          ownerId,
          sessionId,
        ),
      });
    });
    return sessions.getRun(ownerId, sessionId, runId);
  }

  return {
    cancel,
    complete,
    fail,
    recordAssistantOutput,
    recordPhase,
    resume,
    start,
    wait,
  };
}

export type RuntimeTransitionService = ReturnType<
  typeof createRuntimeTransitionService
>;
