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
  createThreadRepository,
  createTurnRepository,
} from "@town/agents";
import { newId, type Id } from "@town/contracts";
import { runMigrations } from "@town/db";

import { createSessionRepository } from "../src/session-repository.js";

let sql: Sql;
let ownerId: Id<"user">;
let otherOwnerId: Id<"user">;

beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 4 });
  await runMigrations(sql);
});

beforeEach(async () => {
  await sql`truncate table users cascade`;
  ownerId = newId<"user">();
  otherOwnerId = newId<"user">();
  await sql`
    insert into users (id, email, timezone)
    values
      (${ownerId}, 'runtime-owner@example.invalid', 'UTC'),
      (${otherOwnerId}, 'runtime-other@example.invalid', 'UTC')
  `;
});

afterAll(async () => {
  await sql.end();
});

async function createAgent(owner: Id<"user">) {
  return createAgentRepository(sql).createPersonal({
    ownerId: owner,
    displayName: "Runtime Test Assistant",
    instructions: "Use only synthetic runtime fixtures.",
    defaultApprovalMode: "respect_tool_setting",
  });
}

async function seedSession() {
  const agent = await createAgent(ownerId);
  const thread = await createThreadRepository(sql).createAssistant({
    ownerId,
    agentId: agent.id,
    title: "Persistent runtime fixture",
    approvalMode: "require_approval",
  });
  const sessionId = newId<"runtime-session">();
  await sql`
    insert into runtime_sessions (
      id, owner_id, thread_id, agent_id, agent_version_id
    ) values (
      ${sessionId}, ${ownerId}, ${thread.id}, ${agent.id},
      ${agent.activeVersion.id}
    )
  `;
  return { agent, sessionId, thread };
}

async function seedQueuedRun(input: {
  sessionId: Id<"runtime-session">;
  threadId: Id<"thread">;
  text: string;
  createdAt: Date;
  byte: number;
}) {
  const turn = await createTurnRepository(sql).appendUser({
    ownerId,
    threadId: input.threadId,
    text: input.text,
    mentions: [],
  });
  const runId = newId<"session-run">();
  await sql`
    insert into session_runs (
      id, owner_id, session_id, thread_id, triggering_turn_id,
      idempotency_hash, request_fingerprint, created_at, updated_at
    ) values (
      ${runId}, ${ownerId}, ${input.sessionId}, ${input.threadId}, ${turn.id},
      ${Buffer.alloc(32, input.byte)}, ${Buffer.alloc(32, input.byte + 10)},
      ${input.createdAt}, ${input.createdAt}
    )
  `;
  return { runId, turn };
}

describe("Session repository reads", () => {
  it("returns safe owner-scoped Sessions pinned to the original AgentVersion", async () => {
    const seeded = await seedSession();
    await createAgentRepository(sql).publishPersonal({
      ownerId,
      expectedRevision: 1,
      displayName: "Runtime Test Assistant",
      instructions: "This newer version must not replace the Session snapshot.",
      defaultApprovalMode: "autonomous",
      changeReason: "Synthetic version pinning test",
    });

    const sessions = createSessionRepository(sql);
    await expect(
      sessions.get(otherOwnerId, seeded.sessionId),
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    await expect(
      sessions.getByThread(otherOwnerId, seeded.thread.id),
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });

    const session = await sessions.get(ownerId, seeded.sessionId);
    expect(session).toMatchObject({
      id: seeded.sessionId,
      ownerId,
      threadId: seeded.thread.id,
      agentId: seeded.agent.id,
      state: "idle",
      revision: 1,
      lastEventSequence: 0,
      agentVersion: {
        id: seeded.agent.activeVersion.id,
        version: 1,
        snapshot: {
          instructions: "Use only synthetic runtime fixtures.",
        },
      },
    });
    expect(await sessions.getByThread(ownerId, seeded.thread.id)).toEqual(
      session,
    );
    expect(JSON.stringify(session)).not.toContain("idempotency");
  });

  it("paginates Runs deterministically with Session-bound cursors", async () => {
    const seeded = await seedSession();
    const first = await seedQueuedRun({
      sessionId: seeded.sessionId,
      threadId: seeded.thread.id,
      text: "First synthetic input",
      createdAt: new Date("2026-08-02T00:00:01.000Z"),
      byte: 1,
    });
    const second = await seedQueuedRun({
      sessionId: seeded.sessionId,
      threadId: seeded.thread.id,
      text: "Second synthetic input",
      createdAt: new Date("2026-08-02T00:00:02.000Z"),
      byte: 2,
    });
    const third = await seedQueuedRun({
      sessionId: seeded.sessionId,
      threadId: seeded.thread.id,
      text: "Third synthetic input",
      createdAt: new Date("2026-08-02T00:00:03.000Z"),
      byte: 3,
    });
    const sessions = createSessionRepository(sql);

    const page1 = await sessions.listRuns({
      ownerId,
      sessionId: seeded.sessionId,
      state: "queued",
      limit: 2,
    });
    expect(page1.items.map(({ id }) => id)).toEqual([
      third.runId,
      second.runId,
    ]);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await sessions.listRuns({
      ownerId,
      sessionId: seeded.sessionId,
      state: "queued",
      cursor: page1.nextCursor ?? undefined,
      limit: 2,
    });
    expect(page2.items.map(({ id }) => id)).toEqual([first.runId]);
    expect(page2.nextCursor).toBeNull();

    const otherThread = await createThreadRepository(sql).createAssistant({
      ownerId,
      agentId: seeded.agent.id,
      title: "Other Session",
      approvalMode: "require_approval",
    });
    const otherSessionId = newId<"runtime-session">();
    await sql`
      insert into runtime_sessions (
        id, owner_id, thread_id, agent_id, agent_version_id
      ) values (
        ${otherSessionId}, ${ownerId}, ${otherThread.id}, ${seeded.agent.id},
        ${seeded.agent.activeVersion.id}
      )
    `;
    await expect(
      sessions.listRuns({
        ownerId,
        sessionId: otherSessionId,
        state: "queued",
        cursor: page1.nextCursor ?? undefined,
        limit: 2,
      }),
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    await expect(
      sessions.listRuns({
        ownerId,
        sessionId: seeded.sessionId,
        state: "not-a-state",
        limit: 2,
      } as never),
    ).rejects.toMatchObject({ name: "ZodError" });
    await expect(
      sessions.listRuns({
        ownerId,
        sessionId: seeded.sessionId,
        limit: 2,
        unknownFilter: true,
      } as never),
    ).rejects.toMatchObject({ name: "ZodError" });
  });
});

describe("atomic message submission", () => {
  it("atomically pins a Session and creates one Turn, Run, job, and ordered events", async () => {
    const agent = await createAgent(ownerId);
    const thread = await createThreadRepository(sql).createAssistant({
      ownerId,
      agentId: agent.id,
      title: "Atomic submission",
      approvalMode: "require_approval",
    });
    const sessions = createSessionRepository(sql);
    const submitted = await sessions.submitMessage({
      ownerId,
      threadId: thread.id,
      idempotencyKey: "atomic-message-1",
      text: "Process this synthetic request.",
      mentions: [],
    });

    expect(submitted).toMatchObject({
      replayed: false,
      session: {
        ownerId,
        threadId: thread.id,
        agentVersion: { id: agent.activeVersion.id },
      },
      run: { state: "queued" },
      turn: {
        role: "user",
        sourceType: "user",
        sourceRef: null,
        text: "Process this synthetic request.",
      },
    });
    const [counts] = await sql<
      {
        sessions: number;
        runs: number;
        jobs: number;
        turns: number;
        assistant_turns: number;
      }[]
    >`
      select
        (select count(*)::int from runtime_sessions) as sessions,
        (select count(*)::int from session_runs) as runs,
        (select count(*)::int from runtime_jobs) as jobs,
        (select count(*)::int from thread_turns) as turns,
        (select count(*)::int from thread_turns where role = 'assistant')
          as assistant_turns
    `;
    expect(counts).toEqual({
      sessions: 1,
      runs: 1,
      jobs: 1,
      turns: 1,
      assistant_turns: 0,
    });
    const events = await sql<{ sequence: number; kind: string }[]>`
      select sequence, kind from session_events
      where session_id = ${submitted.session.id}
      order by sequence
    `;
    expect(events).toEqual([
      { sequence: 1, kind: "input_observed" },
      { sequence: 2, kind: "run_queued" },
    ]);
    const [readState] = await sql<
      {
        read_through_sequence: number;
        force_unread: boolean;
      }[]
    >`
      select read_through_sequence, force_unread from thread_read_states
      where owner_id = ${ownerId} and thread_id = ${thread.id}
    `;
    expect(readState).toEqual({
      read_through_sequence: submitted.turn.sequence,
      force_unread: false,
    });

    const replay = await sessions.submitMessage({
      ownerId,
      threadId: thread.id,
      idempotencyKey: "atomic-message-1",
      text: "Process this synthetic request.",
      mentions: [],
    });
    expect(replay).toMatchObject({
      replayed: true,
      session: { id: submitted.session.id },
      run: { id: submitted.run.id },
      turn: { id: submitted.turn.id },
    });
    await expect(
      sessions.submitMessage({
        ownerId,
        threadId: thread.id,
        idempotencyKey: "atomic-message-1",
        text: "Changed content must not reuse the key.",
        mentions: [],
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("serializes concurrent duplicate submissions into one durable Run", async () => {
    const agent = await createAgent(ownerId);
    const thread = await createThreadRepository(sql).createAssistant({
      ownerId,
      agentId: agent.id,
      title: "Concurrent submission",
      approvalMode: "require_approval",
    });
    const sessions = createSessionRepository(sql);
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        sessions.submitMessage({
          ownerId,
          threadId: thread.id,
          idempotencyKey: "concurrent-message-1",
          text: "Create exactly one queued Run.",
          mentions: [],
        }),
      ),
    );
    expect(new Set(results.map(({ run }) => run.id)).size).toBe(1);
    expect(results.filter(({ replayed }) => !replayed)).toHaveLength(1);
    const [counts] = await sql<
      { turns: number; runs: number; events: number }[]
    >`
      select
        (select count(*)::int from thread_turns) as turns,
        (select count(*)::int from session_runs) as runs,
        (select count(*)::int from session_events) as events
    `;
    expect(counts).toEqual({ turns: 1, runs: 1, events: 2 });
  });

  it("rolls back unavailable references and rejects deleted or cross-owner Threads", async () => {
    const agent = await createAgent(ownerId);
    const otherAgent = await createAgent(otherOwnerId);
    const threads = createThreadRepository(sql);
    const thread = await threads.createAssistant({
      ownerId,
      agentId: agent.id,
      title: "Rollback submission",
      approvalMode: "require_approval",
    });
    const sessions = createSessionRepository(sql);

    await expect(
      sessions.submitMessage({
        ownerId,
        threadId: thread.id,
        idempotencyKey: "invalid-reference",
        text: "Mention an unavailable target.",
        mentions: [
          {
            position: 0,
            targetType: "agent",
            targetId: otherAgent.id,
            label: "Other owner Agent",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "AGENT_NOT_FOUND" });
    const [afterRollback] = await sql<{ sessions: number; turns: number }[]>`
      select
        (select count(*)::int from runtime_sessions) as sessions,
        (select count(*)::int from thread_turns) as turns
    `;
    expect(afterRollback).toEqual({ sessions: 0, turns: 0 });

    await expect(
      sessions.submitMessage({
        ownerId: otherOwnerId,
        threadId: thread.id,
        idempotencyKey: "cross-owner",
        text: "Must not cross owners.",
        mentions: [],
      }),
    ).rejects.toMatchObject({ code: "THREAD_NOT_FOUND" });
    await threads.removeAssistant({
      ownerId,
      threadId: thread.id,
      expectedRevision: 1,
    });
    await expect(
      sessions.submitMessage({
        ownerId,
        threadId: thread.id,
        idempotencyKey: "deleted-thread",
        text: "Must not revive deleted Threads.",
        mentions: [],
      }),
    ).rejects.toMatchObject({ code: "THREAD_NOT_FOUND" });
  });
});
