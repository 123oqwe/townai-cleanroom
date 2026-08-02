import { createHash } from "node:crypto";

import type { Sql } from "postgres";
import { z } from "zod";

import {
  asId,
  decodeCursor,
  encodeCursor,
  idSchema,
  newId,
  type Id,
} from "@town/contracts";

import { ThreadError } from "./errors.js";
import {
  approvalModeSchema,
  threadKindSchema,
  threadStatusSchema,
  type ConversationThread,
  type ThreadKind,
  type ThreadPage,
} from "./types.js";

const createThreadSchema = z
  .object({
    ownerId: idSchema,
    agentId: idSchema,
    title: z.string().trim().min(1).max(500),
    approvalMode: approvalModeSchema,
  })
  .strict();
const updateThreadSchema = z
  .object({
    ownerId: idSchema,
    threadId: idSchema,
    expectedRevision: z.number().int().positive(),
    title: z.string().trim().min(1).max(500),
    status: threadStatusSchema,
    pinned: z.boolean(),
    approvalMode: approvalModeSchema,
    forceUnread: z.boolean(),
  })
  .strict();
const ownerThreadSchema = z
  .object({ ownerId: idSchema, threadId: idSchema })
  .strict();
const markReadSchema = ownerThreadSchema
  .extend({ throughSequence: z.number().int().nonnegative().optional() })
  .strict();
const removeThreadSchema = ownerThreadSchema
  .extend({ expectedRevision: z.number().int().positive() })
  .strict();
const listThreadsSchema = z
  .object({
    ownerId: idSchema,
    kinds: z.array(threadKindSchema).min(1).optional(),
    statuses: z.array(threadStatusSchema).min(1).optional(),
    pinned: z.boolean().optional(),
    unread: z.boolean().optional(),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
const threadCursorKeySchema = z
  .object({
    fingerprint: z.string().min(1),
    pinned: z.boolean(),
    pinnedAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

interface ThreadRow {
  id: string;
  owner_id: string;
  agent_id: string;
  kind: ThreadKind;
  title: string;
  approval_mode: ConversationThread["approvalMode"];
  status: ConversationThread["status"];
  pinned_at: Date | null;
  revision: number;
  last_turn_sequence: number;
  read_through_sequence: number | null;
  unread: boolean;
  created_at: Date;
  updated_at: Date;
}

interface LockedThreadRow {
  id: string;
  kind: ThreadKind;
  title: string;
  revision: number;
  last_turn_sequence: number;
}

function safeThread(row: ThreadRow): ConversationThread {
  return {
    id: asId<"thread">(row.id),
    ownerId: asId<"user">(row.owner_id),
    agentId: asId<"agent">(row.agent_id),
    kind: row.kind,
    title: row.title,
    approvalMode: approvalModeSchema.parse(row.approval_mode),
    status: threadStatusSchema.parse(row.status),
    pinnedAt: row.pinned_at,
    revision: row.revision,
    lastTurnSequence: row.last_turn_sequence,
    readThroughSequence: row.read_through_sequence ?? 0,
    unread: row.unread,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fingerprint(input: {
  ownerId: string;
  kinds: ThreadKind[];
  statuses: ConversationThread["status"][];
  pinned?: boolean | undefined;
  unread?: boolean | undefined;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        ownerId: input.ownerId,
        kinds: [...input.kinds].sort(),
        statuses: [...input.statuses].sort(),
        pinned: input.pinned ?? null,
        unread: input.unread ?? null,
      }),
    )
    .digest("base64url");
}

export function createThreadRepository(sql: Sql) {
  async function get(
    ownerId: Id<"user">,
    threadId: Id<"thread">,
  ): Promise<ConversationThread> {
    const value = ownerThreadSchema.parse({ ownerId, threadId });
    const [row] = await sql<ThreadRow[]>`
      select
        thread.id, thread.owner_id, thread.agent_id, thread.kind, thread.title,
        thread.approval_mode, thread.status, thread.pinned_at, thread.revision,
        thread.last_turn_sequence, thread.created_at, thread.updated_at,
        read_state.read_through_sequence,
        coalesce(read_state.force_unread, false)
          or thread.last_turn_sequence > coalesce(read_state.read_through_sequence, 0)
          as unread
      from threads thread
      left join thread_read_states read_state
        on read_state.owner_id = thread.owner_id
        and read_state.thread_id = thread.id
      where thread.id = ${value.threadId} and thread.owner_id = ${value.ownerId}
        and thread.status <> 'deleted'
    `;
    if (row === undefined) {
      throw new ThreadError("THREAD_NOT_FOUND", "The Thread was not found.");
    }
    return safeThread(row);
  }

  async function create(
    kind: ThreadKind,
    input: z.input<typeof createThreadSchema>,
  ): Promise<ConversationThread> {
    const value = createThreadSchema.parse(input);
    const ownerId = asId<"user">(value.ownerId);
    const threadId = newId<"thread">();
    const rows = await sql`
      insert into threads (
        id, owner_id, agent_id, kind, title, approval_mode, status
      )
      select
        ${threadId}, ${ownerId}, agent.id, ${kind}, ${value.title},
        ${value.approvalMode}, 'active'
      from agents agent
      where agent.id = ${value.agentId} and agent.owner_id = ${ownerId}
        and agent.status = 'active'
      returning id
    `;
    if (rows.count !== 1) {
      throw new ThreadError("THREAD_NOT_FOUND", "The Thread was not found.");
    }
    return get(ownerId, threadId);
  }

  function createAssistant(input: z.input<typeof createThreadSchema>) {
    return create("assistant", input);
  }

  function createTask(input: z.input<typeof createThreadSchema>) {
    return create("task", input);
  }

  async function update(
    input: z.input<typeof updateThreadSchema>,
  ): Promise<ConversationThread> {
    const value = updateThreadSchema.parse(input);
    const ownerId = asId<"user">(value.ownerId);
    const threadId = asId<"thread">(value.threadId);
    await sql.begin(async (transaction) => {
      const [current] = await transaction<LockedThreadRow[]>`
        select id, kind, title, revision, last_turn_sequence from threads
        where id = ${threadId} and owner_id = ${ownerId}
          and status <> 'deleted'
        for update
      `;
      if (current === undefined) {
        throw new ThreadError("THREAD_NOT_FOUND", "The Thread was not found.");
      }
      if (current.revision !== value.expectedRevision) {
        throw new ThreadError(
          "THREAD_REVISION_CONFLICT",
          "The Thread has changed since it was read.",
        );
      }
      if (current.kind === "task" && current.title !== value.title) {
        throw new ThreadError(
          "TASK_THREAD_REQUIRES_TASK_UPDATE",
          "Task Thread titles must be changed through the Task lifecycle.",
        );
      }
      const changed = await transaction`
        update threads
        set title = ${value.title}, status = ${value.status},
            approval_mode = ${value.approvalMode},
            pinned_at = case
              when ${value.pinned} and pinned_at is null then now()
              when ${value.pinned} then pinned_at
              else null
            end,
            revision = revision + 1, updated_at = now()
        where id = ${threadId} and owner_id = ${ownerId}
          and revision = ${value.expectedRevision} and status <> 'deleted'
      `;
      if (changed.count !== 1) {
        throw new ThreadError(
          "THREAD_REVISION_CONFLICT",
          "The Thread has changed since it was read.",
        );
      }
      await transaction`
        insert into thread_read_states (
          owner_id, thread_id, read_through_sequence, force_unread
        ) values (${ownerId}, ${threadId}, 0, ${value.forceUnread})
        on conflict (owner_id, thread_id) do update
        set force_unread = excluded.force_unread
      `;
    });
    return get(ownerId, threadId);
  }

  async function markRead(
    input: z.input<typeof markReadSchema>,
  ): Promise<ConversationThread> {
    const value = markReadSchema.parse(input);
    const ownerId = asId<"user">(value.ownerId);
    const threadId = asId<"thread">(value.threadId);
    await sql.begin(async (transaction) => {
      const [current] = await transaction<LockedThreadRow[]>`
        select id, kind, title, revision, last_turn_sequence from threads
        where id = ${threadId} and owner_id = ${ownerId}
          and status <> 'deleted'
        for update
      `;
      if (current === undefined) {
        throw new ThreadError("THREAD_NOT_FOUND", "The Thread was not found.");
      }
      const throughSequence = Math.min(
        value.throughSequence ?? current.last_turn_sequence,
        current.last_turn_sequence,
      );
      await transaction`
        insert into thread_read_states (
          owner_id, thread_id, read_through_sequence, force_unread, read_at
        ) values (${ownerId}, ${threadId}, ${throughSequence}, false, now())
        on conflict (owner_id, thread_id) do update set
          read_through_sequence = greatest(
            thread_read_states.read_through_sequence,
            excluded.read_through_sequence
          ),
          force_unread = false,
          read_at = now()
      `;
    });
    return get(ownerId, threadId);
  }

  async function removeAssistant(
    input: z.input<typeof removeThreadSchema>,
  ): Promise<void> {
    const value = removeThreadSchema.parse(input);
    const ownerId = asId<"user">(value.ownerId);
    const threadId = asId<"thread">(value.threadId);
    await sql.begin(async (transaction) => {
      const [current] = await transaction<LockedThreadRow[]>`
        select id, kind, title, revision, last_turn_sequence from threads
        where id = ${threadId} and owner_id = ${ownerId}
          and status <> 'deleted'
        for update
      `;
      if (current === undefined) {
        throw new ThreadError("THREAD_NOT_FOUND", "The Thread was not found.");
      }
      if (current.kind === "task") {
        throw new ThreadError(
          "TASK_THREAD_REQUIRES_TASK_DELETE",
          "Task Threads must be deleted through the Task lifecycle.",
        );
      }
      if (current.revision !== value.expectedRevision) {
        throw new ThreadError(
          "THREAD_REVISION_CONFLICT",
          "The Thread has changed since it was read.",
        );
      }
      await transaction`
        update threads
        set status = 'deleted', deleted_at = now(), revision = revision + 1,
            updated_at = now()
        where id = ${threadId} and owner_id = ${ownerId}
          and revision = ${value.expectedRevision} and status <> 'deleted'
      `;
    });
  }

  async function list(
    input: z.input<typeof listThreadsSchema>,
  ): Promise<ThreadPage> {
    const value = listThreadsSchema.parse(input);
    const ownerId = asId<"user">(value.ownerId);
    const kinds = [...new Set(value.kinds ?? threadKindSchema.options)].sort();
    const statuses = [
      ...new Set(value.statuses ?? threadStatusSchema.options),
    ].sort();
    const queryFingerprint = fingerprint({
      ownerId,
      kinds,
      statuses,
      pinned: value.pinned,
      unread: value.unread,
    });
    const decoded =
      value.cursor === undefined ? null : decodeCursor(value.cursor);
    const cursorKey =
      decoded === null
        ? null
        : threadCursorKeySchema.parse(JSON.parse(decoded.key));
    if (cursorKey !== null && cursorKey.fingerprint !== queryFingerprint) {
      throw new z.ZodError([
        {
          code: "custom",
          path: ["cursor"],
          message: "Cursor filter mismatch.",
        },
      ]);
    }
    const cursorPinnedRank = cursorKey?.pinned === true ? 1 : 0;
    const cursorPinnedAt = cursorKey?.pinnedAt ?? "0001-01-01T00:00:00.000Z";
    const cursorUpdatedAt = cursorKey?.updatedAt ?? "9999-12-31T23:59:59.999Z";
    const cursorId = decoded?.id ?? "00000000-0000-7000-8000-000000000000";
    const hasCursor = cursorKey !== null;
    const unreadFilter = value.unread ?? false;
    const hasUnreadFilter = value.unread !== undefined;
    const pinnedFilter = value.pinned ?? false;
    const hasPinnedFilter = value.pinned !== undefined;

    const rows = await sql<ThreadRow[]>`
      with projected as (
        select
          thread.id, thread.owner_id, thread.agent_id, thread.kind, thread.title,
          thread.approval_mode, thread.status, thread.pinned_at, thread.revision,
          thread.last_turn_sequence, thread.created_at, thread.updated_at,
          read_state.read_through_sequence,
          coalesce(read_state.force_unread, false)
            or thread.last_turn_sequence > coalesce(read_state.read_through_sequence, 0)
            as unread
        from threads thread
        left join thread_read_states read_state
          on read_state.owner_id = thread.owner_id
          and read_state.thread_id = thread.id
        where thread.owner_id = ${ownerId} and thread.status <> 'deleted'
      )
      select * from projected
      where kind = any(${sql.array(kinds)}::text[])
        and status = any(${sql.array(statuses)}::text[])
        and (${!hasPinnedFilter} or (pinned_at is not null) = ${pinnedFilter})
        and (${!hasUnreadFilter} or unread = ${unreadFilter})
        and (
          ${!hasCursor}
          or case when pinned_at is not null then 1 else 0 end < ${cursorPinnedRank}
          or (
            case when pinned_at is not null then 1 else 0 end = ${cursorPinnedRank}
            and (
              coalesce(pinned_at, '0001-01-01T00:00:00Z'::timestamptz)
                < ${cursorPinnedAt}::timestamptz
              or (
                coalesce(pinned_at, '0001-01-01T00:00:00Z'::timestamptz)
                  = ${cursorPinnedAt}::timestamptz
                and updated_at < ${cursorUpdatedAt}::timestamptz
              )
              or (
                coalesce(pinned_at, '0001-01-01T00:00:00Z'::timestamptz)
                  = ${cursorPinnedAt}::timestamptz
                and updated_at = ${cursorUpdatedAt}::timestamptz
                and id > ${cursorId}::uuid
              )
            )
          )
        )
      order by (pinned_at is not null) desc,
        pinned_at desc nulls last, updated_at desc, id
      limit ${value.limit + 1}
    `;
    const hasMore = rows.length > value.limit;
    const pageRows = hasMore ? rows.slice(0, value.limit) : rows;
    const items = pageRows.map(safeThread);
    const last = hasMore ? pageRows.at(-1) : undefined;
    const nextCursor =
      last === undefined
        ? null
        : encodeCursor({
            version: 1,
            key: JSON.stringify({
              fingerprint: queryFingerprint,
              pinned: last.pinned_at !== null,
              pinnedAt: last.pinned_at?.toISOString() ?? null,
              updatedAt: last.updated_at.toISOString(),
            }),
            id: asId(last.id),
          });
    return { items, nextCursor };
  }

  return {
    createAssistant,
    createTask,
    get,
    list,
    markRead,
    removeAssistant,
    update,
  };
}

export type ThreadRepository = ReturnType<typeof createThreadRepository>;
