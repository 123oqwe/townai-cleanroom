import type { Sql } from "postgres";
import { z } from "zod";

import { asId, idSchema, newId, type Id } from "@town/contracts";

import { InputRequestError } from "./errors.js";
import { inputRequestStatusSchema, type TaskInputRequest } from "./types.js";

const ownerTaskSchema = z
  .object({ ownerId: idSchema, taskId: idSchema })
  .strict();
const createRequestSchema = ownerTaskSchema
  .extend({ prompt: z.string().trim().min(1).max(10_000) })
  .strict();
const resolveRequestSchema = ownerTaskSchema
  .extend({ requestId: idSchema })
  .strict();
const answerRequestSchema = resolveRequestSchema
  .extend({ response: z.string().trim().min(1).max(50_000) })
  .strict();

interface InputRequestRow {
  id: string;
  task_id: string;
  prompt: string;
  status: z.infer<typeof inputRequestStatusSchema>;
  response: string | null;
  requested_at: Date;
  answered_at: Date | null;
  cancelled_at: Date | null;
}

function safeRequest(row: InputRequestRow): TaskInputRequest {
  return {
    id: asId<"input-request">(row.id),
    taskId: asId<"task">(row.task_id),
    prompt: row.prompt,
    status: inputRequestStatusSchema.parse(row.status),
    response: row.response,
    requestedAt: row.requested_at,
    answeredAt: row.answered_at,
    cancelledAt: row.cancelled_at,
  };
}

export function createInputRequestRepository(sql: Sql) {
  async function assertActiveTask(
    ownerId: Id<"user">,
    taskId: Id<"task">,
  ): Promise<void> {
    const rows = await sql`
      select id from tasks
      where id = ${taskId} and owner_id = ${ownerId} and status <> 'deleted'
    `;
    if (rows.count !== 1) {
      throw new InputRequestError(
        "INPUT_REQUEST_NOT_FOUND",
        "The input request was not found.",
      );
    }
  }

  async function createInternal(
    input: z.input<typeof createRequestSchema>,
  ): Promise<TaskInputRequest> {
    const value = createRequestSchema.parse(input);
    const ownerId = asId<"user">(value.ownerId);
    const taskId = asId<"task">(value.taskId);
    return sql.begin(async (transaction) => {
      const [task] = await transaction<{ id: string }[]>`
        select id from tasks
        where id = ${taskId} and owner_id = ${ownerId} and status <> 'deleted'
        for share
      `;
      if (task === undefined) {
        throw new InputRequestError(
          "INPUT_REQUEST_NOT_FOUND",
          "The input request was not found.",
        );
      }
      const [row] = await transaction<InputRequestRow[]>`
        insert into task_input_requests (id, owner_id, task_id, prompt, status)
        values (
          ${newId<"input-request">()}, ${ownerId}, ${taskId},
          ${value.prompt}, 'pending'
        )
        returning *
      `;
      if (row === undefined)
        throw new Error("Input request insert returned no row.");
      return safeRequest(row);
    });
  }

  async function list(
    input: z.input<typeof ownerTaskSchema>,
  ): Promise<TaskInputRequest[]> {
    const value = ownerTaskSchema.parse(input);
    const ownerId = asId<"user">(value.ownerId);
    const taskId = asId<"task">(value.taskId);
    await assertActiveTask(ownerId, taskId);
    const rows = await sql<InputRequestRow[]>`
      select * from task_input_requests
      where owner_id = ${ownerId} and task_id = ${taskId}
      order by requested_at, id
    `;
    return rows.map(safeRequest);
  }

  async function listPending(ownerId: Id<"user">): Promise<TaskInputRequest[]> {
    const value = idSchema.parse(ownerId);
    const rows = await sql<InputRequestRow[]>`
      select request.* from task_input_requests request
      join tasks task on task.id = request.task_id and task.owner_id = request.owner_id
      where request.owner_id = ${value} and request.status = 'pending'
        and task.status <> 'deleted'
      order by request.requested_at, request.id
      limit 100
    `;
    return rows.map(safeRequest);
  }

  async function answer(
    input: z.input<typeof answerRequestSchema>,
  ): Promise<TaskInputRequest> {
    const value = answerRequestSchema.parse(input);
    const ownerId = asId<"user">(value.ownerId);
    const taskId = asId<"task">(value.taskId);
    const requestId = asId<"input-request">(value.requestId);
    const [row] = await sql<InputRequestRow[]>`
      update task_input_requests request
      set status = 'answered', response = ${value.response}, answered_at = now()
      from tasks task
      where request.id = ${requestId} and request.task_id = ${taskId}
        and request.owner_id = ${ownerId} and request.status = 'pending'
        and task.id = request.task_id and task.owner_id = request.owner_id
        and task.status <> 'deleted'
      returning request.*
    `;
    if (row !== undefined) return safeRequest(row);

    const [existing] = await sql<{ status: string }[]>`
      select request.status
      from task_input_requests request
      join tasks task
        on task.id = request.task_id and task.owner_id = request.owner_id
      where request.id = ${requestId} and request.task_id = ${taskId}
        and request.owner_id = ${ownerId} and task.status <> 'deleted'
    `;
    if (existing === undefined) {
      throw new InputRequestError(
        "INPUT_REQUEST_NOT_FOUND",
        "The input request was not found.",
      );
    }
    throw new InputRequestError(
      "INPUT_REQUEST_ALREADY_RESOLVED",
      "The input request has already been resolved.",
    );
  }

  async function cancel(
    input: z.input<typeof resolveRequestSchema>,
  ): Promise<TaskInputRequest> {
    const value = resolveRequestSchema.parse(input);
    const [row] = await sql<InputRequestRow[]>`
      update task_input_requests request
      set status = 'cancelled', cancelled_at = now()
      from tasks task
      where request.id = ${value.requestId} and request.task_id = ${value.taskId}
        and request.owner_id = ${value.ownerId} and request.status = 'pending'
        and task.id = request.task_id and task.owner_id = request.owner_id
        and task.status <> 'deleted'
      returning request.*
    `;
    if (row !== undefined) return safeRequest(row);
    const [existing] = await sql<{ status: string }[]>`
      select request.status
      from task_input_requests request
      join tasks task
        on task.id = request.task_id and task.owner_id = request.owner_id
      where request.id = ${value.requestId} and request.task_id = ${value.taskId}
        and request.owner_id = ${value.ownerId} and task.status <> 'deleted'
    `;
    if (existing === undefined) {
      throw new InputRequestError(
        "INPUT_REQUEST_NOT_FOUND",
        "The input request was not found.",
      );
    }
    throw new InputRequestError(
      "INPUT_REQUEST_ALREADY_RESOLVED",
      "The input request has already been resolved.",
    );
  }

  return { answer, cancel, createInternal, list, listPending };
}

export type InputRequestRepository = ReturnType<
  typeof createInputRequestRepository
>;
