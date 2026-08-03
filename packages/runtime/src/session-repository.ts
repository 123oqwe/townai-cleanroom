import { createHash } from "node:crypto";

import type { Sql } from "postgres";
import { z } from "zod";

import {
  agentVersionSnapshotSchema,
  appendTurnInTransaction,
  createTurnRepository,
  ThreadError,
  turnMentionsInputSchema,
} from "@town/agents";
import {
  asId,
  decodeCursor,
  encodeCursor,
  idSchema,
  newId,
  type Id,
} from "@town/contracts";

import { RuntimeError } from "./errors.js";
import { deriveRuntimeSessionStateInTransaction } from "./session-state.js";
import {
  runtimePayloadSchema,
  runtimeSessionStateSchema,
  sessionEventKindSchema,
  sessionRunStateSchema,
  type SessionEvent,
  type SessionEventPage,
  type RuntimeSession,
  type MessageSubmission,
  type SessionRun,
  type SessionRunPage,
  type WaitingInputRun,
} from "./types.js";

const submitMessageSchema = z
  .object({
    ownerId: idSchema,
    threadId: idSchema,
    idempotencyKey: z.string().min(1).max(500),
    text: z.string().trim().min(1).max(100_000),
    mentions: turnMentionsInputSchema,
  })
  .strict();

const listRunsSchema = z
  .object({
    ownerId: idSchema,
    sessionId: idSchema,
    state: sessionRunStateSchema.optional(),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();

const runCursorKeySchema = z
  .object({
    fingerprint: z.string().min(1),
    createdAt: z.iso.datetime({ offset: true }),
    id: idSchema,
  })
  .strict();

const listEventsSchema = z
  .object({
    ownerId: idSchema,
    sessionId: idSchema,
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();

const eventCursorKeySchema = z
  .object({
    fingerprint: z.string().min(1),
    sequence: z.number().int().positive(),
  })
  .strict();

interface SessionRow {
  id: string;
  owner_id: string;
  thread_id: string;
  agent_id: string;
  state: string;
  revision: number;
  last_event_sequence: number;
  created_at: Date;
  updated_at: Date;
  version_id: string;
  version_agent_id: string;
  version: number;
  snapshot: unknown;
  change_reason: string | null;
  created_by: "user" | "system";
  version_created_at: Date;
}

interface RunRow {
  id: string;
  session_id: string;
  triggering_turn_id: string;
  state: string;
  attempt: number;
  wait_reason: string | null;
  input_response: string | null;
  outcome: unknown | null;
  error_code: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  updated_at: Date;
}

interface EventRow {
  id: string;
  session_id: string;
  run_id: string;
  sequence: number;
  kind: string;
  payload: unknown;
  created_at: Date;
}

function safeSession(row: SessionRow): RuntimeSession {
  return {
    id: asId<"runtime-session">(row.id),
    ownerId: asId<"user">(row.owner_id),
    threadId: asId<"thread">(row.thread_id),
    agentId: asId<"agent">(row.agent_id),
    state: runtimeSessionStateSchema.parse(row.state),
    revision: row.revision,
    lastEventSequence: row.last_event_sequence,
    agentVersion: {
      id: asId<"agent-version">(row.version_id),
      agentId: asId<"agent">(row.version_agent_id),
      version: row.version,
      snapshot: agentVersionSnapshotSchema.parse(row.snapshot),
      changeReason: row.change_reason,
      createdBy: row.created_by,
      createdAt: row.version_created_at,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeRun(row: RunRow): SessionRun {
  return {
    id: asId<"session-run">(row.id),
    sessionId: asId<"runtime-session">(row.session_id),
    triggeringTurnId: asId<"thread-turn">(row.triggering_turn_id),
    state: sessionRunStateSchema.parse(row.state),
    attempt: row.attempt,
    waitReason: row.wait_reason,
    inputResponse: row.input_response,
    outcome:
      row.outcome === null ? null : runtimePayloadSchema.parse(row.outcome),
    errorCode: row.error_code,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  };
}

function safeEvent(row: EventRow): SessionEvent {
  return {
    id: asId<"session-event">(row.id),
    sessionId: asId<"runtime-session">(row.session_id),
    runId: asId<"session-run">(row.run_id),
    sequence: row.sequence,
    kind: sessionEventKindSchema.parse(row.kind),
    payload: runtimePayloadSchema.parse(row.payload),
    createdAt: row.created_at,
  };
}

function cursorFingerprint(input: {
  ownerId: string;
  sessionId: string;
  state?: string;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("base64url");
}

const sessionSelect = `
  select
    session.id, session.owner_id, session.thread_id, session.agent_id,
    session.state, session.revision, session.last_event_sequence,
    session.created_at, session.updated_at,
    version.id as version_id, version.agent_id as version_agent_id,
    version.version, version.snapshot, version.change_reason,
    version.created_by, version.created_at as version_created_at
  from runtime_sessions session
  join agent_versions version
    on version.owner_id = session.owner_id
    and version.agent_id = session.agent_id
    and version.id = session.agent_version_id
`;

export function createSessionRepository(sql: Sql) {
  async function get(
    ownerId: Id<"user">,
    sessionId: Id<"runtime-session">,
  ): Promise<RuntimeSession> {
    const parsedOwnerId = asId<"user">(ownerId);
    const parsedSessionId = asId<"runtime-session">(sessionId);
    const rows = await sql.unsafe<SessionRow[]>(
      `${sessionSelect} where session.owner_id = $1 and session.id = $2`,
      [parsedOwnerId, parsedSessionId],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new RuntimeError("SESSION_NOT_FOUND", "The Session was not found.");
    }
    return safeSession(row);
  }

  async function getByThread(
    ownerId: Id<"user">,
    threadId: Id<"thread">,
  ): Promise<RuntimeSession> {
    const parsedOwnerId = asId<"user">(ownerId);
    const parsedThreadId = asId<"thread">(threadId);
    const rows = await sql.unsafe<SessionRow[]>(
      `${sessionSelect} where session.owner_id = $1 and session.thread_id = $2`,
      [parsedOwnerId, parsedThreadId],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new RuntimeError("SESSION_NOT_FOUND", "The Session was not found.");
    }
    return safeSession(row);
  }

  async function listRuns(
    input: z.input<typeof listRunsSchema>,
  ): Promise<SessionRunPage> {
    const value = listRunsSchema.parse(input);
    const ownerId = asId<"user">(value.ownerId);
    const sessionId = asId<"runtime-session">(value.sessionId);
    await get(ownerId, sessionId);

    const fingerprint = cursorFingerprint({
      ownerId,
      sessionId,
      ...(value.state === undefined ? {} : { state: value.state }),
    });
    const decoded =
      value.cursor === undefined ? null : decodeCursor(value.cursor);
    const cursorKey =
      decoded === null
        ? null
        : runCursorKeySchema.parse(JSON.parse(decoded.key));
    if (cursorKey !== null && cursorKey.fingerprint !== fingerprint) {
      throw new RuntimeError("SESSION_NOT_FOUND", "The Session was not found.");
    }
    const cursorCreatedAt =
      cursorKey === null
        ? new Date("9999-12-31T23:59:59.999Z")
        : new Date(cursorKey.createdAt);
    const cursorId = cursorKey?.id ?? "ffffffff-ffff-ffff-ffff-ffffffffffff";

    const rows = await sql<RunRow[]>`
      select
        id, session_id, triggering_turn_id, state, attempt, wait_reason,
        input_response,
        outcome, error_code, created_at, started_at, finished_at, updated_at
      from session_runs
      where owner_id = ${ownerId} and session_id = ${sessionId}
        and (${value.state ?? null}::text is null or state = ${value.state ?? null})
        and (created_at, id) < (${cursorCreatedAt}, ${cursorId}::uuid)
      order by created_at desc, id desc
      limit ${value.limit + 1}
    `;
    const hasMore = rows.length > value.limit;
    const pageRows = hasMore ? rows.slice(0, value.limit) : rows;
    const items = pageRows.map(safeRun);
    const last = hasMore ? pageRows.at(-1) : undefined;
    const nextCursor =
      last === undefined
        ? null
        : encodeCursor({
            version: 1,
            key: JSON.stringify({
              fingerprint,
              createdAt: last.created_at.toISOString(),
              id: last.id,
            }),
            id: asId(last.id),
          });
    return { items, nextCursor };
  }

  async function getRun(
    ownerId: Id<"user">,
    sessionId: Id<"runtime-session">,
    runId: Id<"session-run">,
  ): Promise<SessionRun> {
    const parsedOwnerId = asId<"user">(ownerId);
    const parsedSessionId = asId<"runtime-session">(sessionId);
    const parsedRunId = asId<"session-run">(runId);
    const [row] = await sql<RunRow[]>`
      select
        id, session_id, triggering_turn_id, state, attempt, wait_reason,
        input_response,
        outcome, error_code, created_at, started_at, finished_at, updated_at
      from session_runs
      where owner_id = ${parsedOwnerId} and session_id = ${parsedSessionId}
        and id = ${parsedRunId}
    `;
    if (row === undefined) {
      throw new RuntimeError("RUN_NOT_FOUND", "The Run was not found.");
    }
    return safeRun(row);
  }

  async function listEvents(
    input: z.input<typeof listEventsSchema>,
  ): Promise<SessionEventPage> {
    const value = listEventsSchema.parse(input);
    const ownerId = asId<"user">(value.ownerId);
    const sessionId = asId<"runtime-session">(value.sessionId);
    await get(ownerId, sessionId);
    const fingerprint = cursorFingerprint({ ownerId, sessionId });
    const decoded =
      value.cursor === undefined ? null : decodeCursor(value.cursor);
    const cursorKey =
      decoded === null
        ? null
        : eventCursorKeySchema.parse(JSON.parse(decoded.key));
    if (cursorKey !== null && cursorKey.fingerprint !== fingerprint) {
      throw new RuntimeError("SESSION_NOT_FOUND", "The Session was not found.");
    }
    const cursorSequence = cursorKey?.sequence ?? 0;
    const rows = await sql<EventRow[]>`
      select id, session_id, run_id, sequence, kind, payload, created_at
      from session_events
      where owner_id = ${ownerId} and session_id = ${sessionId}
        and sequence > ${cursorSequence}
      order by sequence, id
      limit ${value.limit + 1}
    `;
    const hasMore = rows.length > value.limit;
    const pageRows = hasMore ? rows.slice(0, value.limit) : rows;
    const items = pageRows.map(safeEvent);
    const last = hasMore ? pageRows.at(-1) : undefined;
    const nextCursor =
      last === undefined
        ? null
        : encodeCursor({
            version: 1,
            key: JSON.stringify({
              fingerprint,
              sequence: last.sequence,
            }),
            id: asId(last.id),
          });
    return { items, nextCursor };
  }

  async function listWaitingInput(
    ownerId: Id<"user">,
  ): Promise<WaitingInputRun[]> {
    const parsedOwnerId = asId<"user">(ownerId);
    const rows = await sql<RunRow[]>`
      select id, session_id, triggering_turn_id, state, attempt, wait_reason,
        input_response, outcome, error_code, created_at, started_at, finished_at,
        updated_at
      from session_runs
      where owner_id = ${parsedOwnerId} and state = 'waiting_user_input'
      order by updated_at desc, id desc
      limit 100
    `;
    return rows.map((row) => ({
      sessionId: asId<"runtime-session">(row.session_id),
      run: safeRun(row),
    }));
  }

  async function submitMessage(
    input: z.input<typeof submitMessageSchema>,
  ): Promise<MessageSubmission> {
    const value = submitMessageSchema.parse(input);
    const ownerId = asId<"user">(value.ownerId);
    const threadId = asId<"thread">(value.threadId);
    const idempotencyHash = createHash("sha256")
      .update(value.idempotencyKey)
      .digest();
    const canonicalMentions = [...value.mentions].sort(
      (left, right) => left.position - right.position,
    );
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify({ text: value.text, mentions: canonicalMentions }))
      .digest();

    const result = await sql.begin(async (transaction) => {
      let [session] = await transaction<{ id: string }[]>`
        select id from runtime_sessions
        where owner_id = ${ownerId} and thread_id = ${threadId}
        for update
      `;
      if (session === undefined) {
        const [threadSnapshot] = await transaction<
          { agent_id: string; active_version_id: string }[]
        >`
          select thread.agent_id, agent.active_version_id
          from threads thread
          join agents agent
            on agent.owner_id = thread.owner_id and agent.id = thread.agent_id
          where thread.owner_id = ${ownerId} and thread.id = ${threadId}
            and thread.status <> 'deleted' and agent.status = 'active'
            and agent.active_version_id is not null
        `;
        if (threadSnapshot === undefined) {
          throw new ThreadError(
            "THREAD_NOT_FOUND",
            "The Thread was not found.",
          );
        }
        await transaction`
          insert into runtime_sessions (
            id, owner_id, thread_id, agent_id, agent_version_id
          ) values (
            ${newId<"runtime-session">()}, ${ownerId}, ${threadId},
            ${threadSnapshot.agent_id}, ${threadSnapshot.active_version_id}
          )
          on conflict (owner_id, thread_id) do nothing
        `;
        [session] = await transaction<{ id: string }[]>`
          select id from runtime_sessions
          where owner_id = ${ownerId} and thread_id = ${threadId}
          for update
        `;
      }
      if (session === undefined) {
        throw new Error("Session creation returned no row.");
      }
      const sessionId = asId<"runtime-session">(session.id);
      const [thread] = await transaction<{ id: string }[]>`
        select thread.id from threads thread
        join agents agent
          on agent.owner_id = thread.owner_id and agent.id = thread.agent_id
        where thread.owner_id = ${ownerId} and thread.id = ${threadId}
          and thread.status <> 'deleted' and agent.status = 'active'
        for update of thread
      `;
      if (thread === undefined) {
        throw new ThreadError("THREAD_NOT_FOUND", "The Thread was not found.");
      }

      const [existing] = await transaction<
        {
          id: string;
          triggering_turn_id: string;
          request_fingerprint: Buffer;
        }[]
      >`
        select id, triggering_turn_id, request_fingerprint
        from session_runs
        where owner_id = ${ownerId} and session_id = ${sessionId}
          and idempotency_hash = ${idempotencyHash}
      `;
      if (existing !== undefined) {
        if (!existing.request_fingerprint.equals(requestFingerprint)) {
          throw new RuntimeError(
            "IDEMPOTENCY_CONFLICT",
            "The idempotency key was already used for different input.",
          );
        }
        return {
          sessionId,
          runId: asId<"session-run">(existing.id),
          turnId: asId<"thread-turn">(existing.triggering_turn_id),
          replayed: true,
        };
      }

      const turn = await appendTurnInTransaction(transaction, {
        ownerId,
        threadId,
        role: "user",
        text: value.text,
        sourceType: "user",
        sourceRef: null,
        mentions: canonicalMentions,
      });
      const runId = newId<"session-run">();
      await transaction`
        insert into session_runs (
          id, owner_id, session_id, thread_id, triggering_turn_id,
          idempotency_hash, request_fingerprint
        ) values (
          ${runId}, ${ownerId}, ${sessionId}, ${threadId}, ${turn.id},
          ${idempotencyHash}, ${requestFingerprint}
        )
      `;
      await transaction`
        insert into runtime_jobs (run_id, owner_id, session_id)
        values (${runId}, ${ownerId}, ${sessionId})
      `;
      const sessionState = await deriveRuntimeSessionStateInTransaction(
        transaction,
        ownerId,
        sessionId,
      );
      const [sequence] = await transaction<{ last_event_sequence: number }[]>`
        update runtime_sessions
        set state = ${sessionState},
            last_event_sequence = last_event_sequence + 2,
            revision = revision + 1, updated_at = now()
        where owner_id = ${ownerId} and id = ${sessionId}
        returning last_event_sequence
      `;
      if (sequence === undefined) {
        throw new Error("Session event allocation returned no row.");
      }
      const firstSequence = sequence.last_event_sequence - 1;
      await transaction`
        insert into session_events (
          id, owner_id, session_id, run_id, sequence, kind, payload
        ) values
          (
            ${newId<"session-event">()}, ${ownerId}, ${sessionId}, ${runId},
            ${firstSequence}, 'input_observed',
            ${transaction.json({ turnId: turn.id, turnSequence: turn.sequence })}
          ),
          (
            ${newId<"session-event">()}, ${ownerId}, ${sessionId}, ${runId},
            ${firstSequence + 1}, 'run_queued',
            ${transaction.json({ runId })}
          )
      `;
      await transaction`
        insert into thread_read_states (
          owner_id, thread_id, read_through_sequence, force_unread, read_at
        ) values (${ownerId}, ${threadId}, ${turn.sequence}, false, now())
        on conflict (owner_id, thread_id) do update set
          read_through_sequence = greatest(
            thread_read_states.read_through_sequence,
            excluded.read_through_sequence
          ),
          force_unread = false,
          read_at = now()
      `;
      return { sessionId, runId, turnId: turn.id, replayed: false };
    });

    const [session, run, turn] = await Promise.all([
      get(ownerId, result.sessionId),
      getRun(ownerId, result.sessionId, result.runId),
      createTurnRepository(sql).get({
        ownerId,
        threadId,
        turnId: result.turnId,
      }),
    ]);
    return { session, run, turn, replayed: result.replayed };
  }

  return {
    get,
    getByThread,
    getRun,
    listEvents,
    listRuns,
    listWaitingInput,
    submitMessage,
  };
}

export type SessionRepository = ReturnType<typeof createSessionRepository>;
