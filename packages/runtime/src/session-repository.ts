import { createHash } from "node:crypto";

import type { Sql } from "postgres";
import { z } from "zod";

import { agentVersionSnapshotSchema } from "@town/agents";
import {
  asId,
  decodeCursor,
  encodeCursor,
  idSchema,
  type Id,
} from "@town/contracts";

import { RuntimeError } from "./errors.js";
import {
  runtimePayloadSchema,
  runtimeSessionStateSchema,
  sessionRunStateSchema,
  type RuntimeSession,
  type SessionRun,
  type SessionRunPage,
} from "./types.js";

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
  outcome: unknown | null;
  error_code: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  updated_at: Date;
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
    outcome:
      row.outcome === null ? null : runtimePayloadSchema.parse(row.outcome),
    errorCode: row.error_code,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  };
}

function cursorFingerprint(input: {
  ownerId: string;
  sessionId: string;
  state?: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("base64url");
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
      cursorKey === null ? new Date("9999-12-31T23:59:59.999Z") : new Date(cursorKey.createdAt);
    const cursorId = cursorKey?.id ?? "ffffffff-ffff-ffff-ffff-ffffffffffff";

    const rows = await sql<RunRow[]>`
      select
        id, session_id, triggering_turn_id, state, attempt, wait_reason,
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

  return { get, getByThread, listRuns };
}

export type SessionRepository = ReturnType<typeof createSessionRepository>;
