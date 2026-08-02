import { createHash } from "node:crypto";

import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";

import {
  asId,
  decodeCursor,
  encodeCursor,
  idSchema,
  newId,
  type Id,
} from "@town/contracts";

import { AgentError, TaskError, ThreadError } from "./errors.js";
import { createThreadRepository } from "./thread-repository.js";
import {
  approvalModeSchema,
  taskSourceTypeSchema,
  taskStatusSchema,
  type Task,
  type TaskDetail,
  type TaskPage,
  type TaskSource,
} from "./types.js";

const taskFields = {
  ownerId: idSchema,
  agentId: idSchema,
  title: z.string().trim().min(1).max(500),
  description: z.string().max(20_000),
  approvalMode: approvalModeSchema,
  scheduledFor: z.date().optional(),
};
const createTaskSchema = z
  .object({
    ...taskFields,
    sourceThreads: z.array(idSchema).max(100),
  })
  .strict();
const sourceInputSchema = z
  .object({
    sourceType: taskSourceTypeSchema,
    sourceRef: z.string().trim().min(1).max(2_000),
    accountId: idSchema.optional(),
    sourceLabel: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
const createInternalSchema = z
  .object({
    ...taskFields,
    sources: z.array(sourceInputSchema).max(100),
  })
  .strict();
const updateTaskSchema = z
  .object({
    ownerId: idSchema,
    taskId: idSchema,
    expectedRevision: z.number().int().positive(),
    title: z.string().trim().min(1).max(500),
    description: z.string().max(20_000),
    status: taskStatusSchema,
    scheduledFor: z.date().nullable(),
  })
  .strict();
const ownerTaskSchema = z
  .object({ ownerId: idSchema, taskId: idSchema })
  .strict();
const removeTaskSchema = ownerTaskSchema
  .extend({ expectedRevision: z.number().int().positive() })
  .strict();
const listTasksSchema = z
  .object({
    ownerId: idSchema,
    statuses: z.array(taskStatusSchema).min(1).optional(),
    scheduledFrom: z.date().optional(),
    scheduledTo: z.date().optional(),
    unread: z.boolean().optional(),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine(
    ({ scheduledFrom, scheduledTo }) =>
      scheduledFrom === undefined ||
      scheduledTo === undefined ||
      scheduledFrom <= scheduledTo,
    { message: "scheduledFrom must not be after scheduledTo." },
  );
const taskCursorKeySchema = z
  .object({
    fingerprint: z.string().min(1),
    scheduledFor: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

type SourceInput = z.infer<typeof sourceInputSchema>;

interface TaskRow {
  id: string;
  owner_id: string;
  thread_id: string;
  title: string;
  description: string;
  status: "open" | "completed";
  scheduled_for: Date | null;
  revision: number;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  unread: boolean;
}

interface LockedTaskRow {
  id: string;
  thread_id: string;
  status: "open" | "completed";
  revision: number;
  scheduled_for: Date | null;
}

interface SourceRow {
  id: string;
  task_id: string;
  source_type: z.infer<typeof taskSourceTypeSchema>;
  source_ref: string;
  account_id: string | null;
  source_label: string | null;
  created_at: Date;
}

function safeTask(row: TaskRow): Task {
  return {
    id: asId<"task">(row.id),
    ownerId: asId<"user">(row.owner_id),
    threadId: asId<"thread">(row.thread_id),
    title: row.title,
    description: row.description,
    status: taskStatusSchema.parse(row.status),
    scheduledFor: row.scheduled_for,
    revision: row.revision,
    completedAt: row.completed_at,
    unread: row.unread,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeSource(row: SourceRow): TaskSource {
  return {
    id: asId<"task-source">(row.id),
    sourceType: taskSourceTypeSchema.parse(row.source_type),
    sourceRef: row.source_ref,
    accountId:
      row.account_id === null
        ? null
        : asId<"connected-account">(row.account_id),
    sourceLabel: row.source_label,
    createdAt: row.created_at,
  };
}

function requireFutureSchedule(value: Date | undefined | null): void {
  if (value !== undefined && value !== null && value <= new Date()) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["scheduledFor"],
        message: "Schedule must be future.",
      },
    ]);
  }
}

function taskFingerprint(value: {
  ownerId: string;
  statuses: ("open" | "completed")[];
  scheduledFrom?: Date | undefined;
  scheduledTo?: Date | undefined;
  unread?: boolean | undefined;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        ownerId: value.ownerId,
        statuses: [...value.statuses].sort(),
        scheduledFrom: value.scheduledFrom?.toISOString() ?? null,
        scheduledTo: value.scheduledTo?.toISOString() ?? null,
        unread: value.unread ?? null,
      }),
    )
    .digest("base64url");
}

async function validateSource(
  transaction: Sql | TransactionSql,
  ownerId: Id<"user">,
  source: SourceInput,
): Promise<void> {
  if (source.sourceType === "thread") {
    const parsed = idSchema.safeParse(source.sourceRef);
    if (!parsed.success) {
      throw new ThreadError("THREAD_NOT_FOUND", "The Thread was not found.");
    }
    const rows = await transaction`
      select id from threads
      where id = ${parsed.data} and owner_id = ${ownerId}
        and status <> 'deleted'
    `;
    if (rows.count !== 1) {
      throw new ThreadError("THREAD_NOT_FOUND", "The Thread was not found.");
    }
  }
  if (source.accountId !== undefined) {
    const rows = await transaction`
      select id from connected_accounts
      where id = ${source.accountId} and owner_id = ${ownerId}
    `;
    if (rows.count !== 1) {
      throw new TaskError(
        "REFERENCE_UNAVAILABLE",
        "The source account is unavailable.",
      );
    }
  }
}

export function createTaskRepository(sql: Sql) {
  async function get(
    ownerId: Id<"user">,
    taskId: Id<"task">,
  ): Promise<TaskDetail> {
    const value = ownerTaskSchema.parse({ ownerId, taskId });
    const [row] = await sql<TaskRow[]>`
      select
        task.id, task.owner_id, task.thread_id, task.title, task.description,
        task.status, task.scheduled_for, task.revision, task.created_at,
        task.updated_at, task.completed_at,
        coalesce(read_state.force_unread, false)
          or thread.last_turn_sequence > coalesce(read_state.read_through_sequence, 0)
          as unread
      from tasks task
      join threads thread
        on thread.owner_id = task.owner_id and thread.id = task.thread_id
      left join thread_read_states read_state
        on read_state.owner_id = task.owner_id
        and read_state.thread_id = task.thread_id
      where task.id = ${value.taskId} and task.owner_id = ${value.ownerId}
        and task.status <> 'deleted' and thread.status <> 'deleted'
    `;
    if (row === undefined) {
      throw new TaskError("TASK_NOT_FOUND", "The Task was not found.");
    }
    const sourceRows = await sql<SourceRow[]>`
      select * from task_source_refs
      where owner_id = ${value.ownerId} and task_id = ${value.taskId}
      order by created_at, id
    `;
    return {
      task: safeTask(row),
      thread: await createThreadRepository(sql).get(
        asId<"user">(value.ownerId),
        asId<"thread">(row.thread_id),
      ),
      sources: sourceRows.map(safeSource),
    };
  }

  async function createWithSources(input: {
    ownerId: Id<"user">;
    agentId: Id<"agent">;
    title: string;
    description: string;
    approvalMode: z.infer<typeof approvalModeSchema>;
    scheduledFor?: Date | undefined;
    sources: SourceInput[];
  }): Promise<TaskDetail> {
    requireFutureSchedule(input.scheduledFor);
    const taskId = newId<"task">();
    const threadId = newId<"thread">();
    await sql.begin(async (transaction) => {
      const threadRows = await transaction`
        insert into threads (
          id, owner_id, agent_id, kind, title, approval_mode, status
        )
        select
          ${threadId}, ${input.ownerId}, agent.id, 'task', ${input.title},
          ${input.approvalMode}, 'active'
        from agents agent
        where agent.id = ${input.agentId} and agent.owner_id = ${input.ownerId}
          and agent.status = 'active'
        returning id
      `;
      if (threadRows.count !== 1) {
        throw new AgentError("AGENT_NOT_FOUND", "The Agent was not found.");
      }
      await transaction`
        insert into thread_read_states (
          owner_id, thread_id, read_through_sequence, force_unread
        ) values (${input.ownerId}, ${threadId}, 0, false)
      `;
      await transaction`
        insert into tasks (
          id, owner_id, thread_id, title, description, status, scheduled_for
        ) values (
          ${taskId}, ${input.ownerId}, ${threadId}, ${input.title},
          ${input.description}, 'open', ${input.scheduledFor ?? null}
        )
      `;
      for (const source of input.sources) {
        await validateSource(transaction, input.ownerId, source);
        await transaction`
          insert into task_source_refs (
            id, owner_id, task_id, source_type, source_ref,
            account_id, source_label
          ) values (
            ${newId<"task-source">()}, ${input.ownerId}, ${taskId},
            ${source.sourceType}, ${source.sourceRef},
            ${source.accountId ?? null}, ${source.sourceLabel ?? null}
          )
        `;
      }
    });
    return get(input.ownerId, taskId);
  }

  async function create(input: z.input<typeof createTaskSchema>) {
    const value = createTaskSchema.parse(input);
    return createWithSources({
      ownerId: asId<"user">(value.ownerId),
      agentId: asId<"agent">(value.agentId),
      title: value.title,
      description: value.description,
      approvalMode: value.approvalMode,
      scheduledFor: value.scheduledFor,
      sources: value.sourceThreads.map((threadId) => ({
        sourceType: "thread" as const,
        sourceRef: threadId,
      })),
    });
  }

  async function createInternal(input: z.input<typeof createInternalSchema>) {
    const value = createInternalSchema.parse(input);
    return createWithSources({
      ownerId: asId<"user">(value.ownerId),
      agentId: asId<"agent">(value.agentId),
      title: value.title,
      description: value.description,
      approvalMode: value.approvalMode,
      scheduledFor: value.scheduledFor,
      sources: value.sources,
    });
  }

  async function update(
    input: z.input<typeof updateTaskSchema>,
  ): Promise<TaskDetail> {
    const value = updateTaskSchema.parse(input);
    const ownerId = asId<"user">(value.ownerId);
    const taskId = asId<"task">(value.taskId);
    await sql.begin(async (transaction) => {
      const [current] = await transaction<LockedTaskRow[]>`
        select id, thread_id, status, revision, scheduled_for from tasks
        where id = ${taskId} and owner_id = ${ownerId} and status <> 'deleted'
        for update
      `;
      if (current === undefined) {
        throw new TaskError("TASK_NOT_FOUND", "The Task was not found.");
      }
      if (current.revision !== value.expectedRevision) {
        throw new TaskError(
          "TASK_REVISION_CONFLICT",
          "The Task has changed since it was read.",
        );
      }
      const scheduleChanged =
        current.scheduled_for?.getTime() !== value.scheduledFor?.getTime();
      if (scheduleChanged) requireFutureSchedule(value.scheduledFor);
      const completedAt =
        value.status === "completed"
          ? current.status === "completed"
            ? undefined
            : new Date()
          : null;
      const updated = await transaction`
        update tasks set
          title = ${value.title}, description = ${value.description},
          status = ${value.status}, scheduled_for = ${value.scheduledFor},
          completed_at = case
            when ${value.status} = 'open' then null
            when status = 'completed' then completed_at
            else ${completedAt ?? new Date()}
          end,
          revision = revision + 1, updated_at = now()
        where id = ${taskId} and owner_id = ${ownerId}
          and revision = ${value.expectedRevision} and status <> 'deleted'
      `;
      if (updated.count !== 1) {
        throw new TaskError(
          "TASK_REVISION_CONFLICT",
          "The Task has changed since it was read.",
        );
      }
      await transaction`
        update threads set title = ${value.title}, revision = revision + 1,
          updated_at = now()
        where id = ${current.thread_id} and owner_id = ${ownerId}
          and status <> 'deleted'
      `;
    });
    return get(ownerId, taskId);
  }

  async function remove(
    input: z.input<typeof removeTaskSchema>,
  ): Promise<void> {
    const value = removeTaskSchema.parse(input);
    const ownerId = asId<"user">(value.ownerId);
    const taskId = asId<"task">(value.taskId);
    await sql.begin(async (transaction) => {
      const [current] = await transaction<LockedTaskRow[]>`
        select id, thread_id, status, revision, scheduled_for from tasks
        where id = ${taskId} and owner_id = ${ownerId} and status <> 'deleted'
        for update
      `;
      if (current === undefined) {
        throw new TaskError("TASK_NOT_FOUND", "The Task was not found.");
      }
      if (current.revision !== value.expectedRevision) {
        throw new TaskError(
          "TASK_REVISION_CONFLICT",
          "The Task has changed since it was read.",
        );
      }
      await transaction`
        update task_input_requests
        set status = 'cancelled', cancelled_at = now()
        where owner_id = ${ownerId} and task_id = ${taskId}
          and status = 'pending'
      `;
      await transaction`
        update tasks set status = 'deleted', deleted_at = now(),
          revision = revision + 1, updated_at = now()
        where id = ${taskId} and owner_id = ${ownerId}
          and revision = ${value.expectedRevision} and status <> 'deleted'
      `;
      await transaction`
        update threads set status = 'deleted', deleted_at = now(),
          revision = revision + 1, updated_at = now()
        where id = ${current.thread_id} and owner_id = ${ownerId}
          and status <> 'deleted'
      `;
    });
  }

  async function markRead(input: z.input<typeof ownerTaskSchema>) {
    const value = ownerTaskSchema.parse(input);
    const detail = await get(
      asId<"user">(value.ownerId),
      asId<"task">(value.taskId),
    );
    await createThreadRepository(sql).markRead({
      ownerId: detail.task.ownerId,
      threadId: detail.task.threadId,
    });
    return get(detail.task.ownerId, detail.task.id);
  }

  async function list(
    input: z.input<typeof listTasksSchema>,
  ): Promise<TaskPage> {
    const value = listTasksSchema.parse(input);
    const ownerId = asId<"user">(value.ownerId);
    const statuses = [
      ...new Set(value.statuses ?? taskStatusSchema.options),
    ].sort();
    const queryFingerprint = taskFingerprint({
      ownerId,
      statuses,
      scheduledFrom: value.scheduledFrom,
      scheduledTo: value.scheduledTo,
      unread: value.unread,
    });
    const decoded =
      value.cursor === undefined ? null : decodeCursor(value.cursor);
    const cursorKey =
      decoded === null
        ? null
        : taskCursorKeySchema.parse(JSON.parse(decoded.key));
    if (cursorKey !== null && cursorKey.fingerprint !== queryFingerprint) {
      throw new Error("The Task cursor belongs to different filters.");
    }
    const cursorScheduleRank = cursorKey?.scheduledFor === null ? 1 : 0;
    const cursorScheduledFor =
      cursorKey?.scheduledFor ?? "9999-12-31T23:59:59.999Z";
    const cursorUpdatedAt = cursorKey?.updatedAt ?? "9999-12-31T23:59:59.999Z";
    const cursorId = decoded?.id ?? "00000000-0000-7000-8000-000000000000";
    const hasCursor = cursorKey !== null;
    const hasUnreadFilter = value.unread !== undefined;
    const unreadFilter = value.unread ?? false;
    const rows = await sql<TaskRow[]>`
      with projected as (
        select
          task.id, task.owner_id, task.thread_id, task.title, task.description,
          task.status, task.scheduled_for, task.revision, task.created_at,
          task.updated_at, task.completed_at,
          coalesce(read_state.force_unread, false)
            or thread.last_turn_sequence > coalesce(read_state.read_through_sequence, 0)
            as unread
        from tasks task
        join threads thread
          on thread.owner_id = task.owner_id and thread.id = task.thread_id
        left join thread_read_states read_state
          on read_state.owner_id = task.owner_id
          and read_state.thread_id = task.thread_id
        where task.owner_id = ${ownerId} and task.status <> 'deleted'
          and thread.status <> 'deleted'
      )
      select * from projected
      where status = any(${sql.array(statuses)}::text[])
        and (${value.scheduledFrom ?? null}::timestamptz is null
          or scheduled_for >= ${value.scheduledFrom ?? null})
        and (${value.scheduledTo ?? null}::timestamptz is null
          or scheduled_for <= ${value.scheduledTo ?? null})
        and (${!hasUnreadFilter} or unread = ${unreadFilter})
        and (
          ${!hasCursor}
          or case when scheduled_for is null then 1 else 0 end
            > ${cursorScheduleRank}
          or (
            case when scheduled_for is null then 1 else 0 end
              = ${cursorScheduleRank}
            and (
              coalesce(scheduled_for, '9999-12-31T23:59:59.999Z'::timestamptz)
                > ${cursorScheduledFor}::timestamptz
              or (
                coalesce(scheduled_for, '9999-12-31T23:59:59.999Z'::timestamptz)
                  = ${cursorScheduledFor}::timestamptz
                and updated_at < ${cursorUpdatedAt}::timestamptz
              )
              or (
                coalesce(scheduled_for, '9999-12-31T23:59:59.999Z'::timestamptz)
                  = ${cursorScheduledFor}::timestamptz
                and updated_at = ${cursorUpdatedAt}::timestamptz
                and id > ${cursorId}::uuid
              )
            )
          )
        )
      order by scheduled_for asc nulls last, updated_at desc, id
      limit ${value.limit + 1}
    `;
    const hasMore = rows.length > value.limit;
    const pageRows = hasMore ? rows.slice(0, value.limit) : rows;
    const items = await Promise.all(
      pageRows.map((row) => get(ownerId, asId<"task">(row.id))),
    );
    const last = hasMore ? pageRows.at(-1) : undefined;
    const nextCursor =
      last === undefined
        ? null
        : encodeCursor({
            version: 1,
            key: JSON.stringify({
              fingerprint: queryFingerprint,
              scheduledFor: last.scheduled_for?.toISOString() ?? null,
              updatedAt: last.updated_at.toISOString(),
            }),
            id: asId(last.id),
          });
    return { items, nextCursor };
  }

  return { create, createInternal, get, list, markRead, remove, update };
}

export type TaskRepository = ReturnType<typeof createTaskRepository>;
