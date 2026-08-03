import type { Sql } from "postgres";
import { z } from "zod";

import { asId, idSchema, newId, type Id } from "@town/contracts";

const resultInput = z
  .object({
    ownerId: idSchema,
    routineScheduleId: idSchema.nullable(),
    sessionId: idSchema,
    runId: idSchema,
    subject: z.string().trim().min(1).max(500),
  })
  .strict();
const outputSchema = z.record(z.string(), z.json());

export type RoutineResultStatus = "completed" | "failed";

export interface RoutineResult {
  id: Id<"routine-result">;
  ownerId: Id<"user">;
  routineScheduleId: Id<"routine-schedule"> | null;
  sessionId: Id<"runtime-session">;
  runId: Id<"session-run">;
  subject: string;
  status: RoutineResultStatus;
  output: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  documentId: Id<"content"> | null;
  notificationId: Id<"notification-delivery"> | null;
  createdAt: Date;
  updatedAt: Date;
}

type Row = {
  id: string;
  owner_id: string;
  routine_schedule_id: string | null;
  session_id: string;
  run_id: string;
  subject: string;
  status: RoutineResultStatus;
  output: Record<string, unknown> | null;
  error_code: string | null;
  error_message: string | null;
  document_id: string | null;
  notification_id: string | null;
  created_at: Date;
  updated_at: Date;
};

function safe(row: Row): RoutineResult {
  return {
    id: asId<"routine-result">(row.id),
    ownerId: asId<"user">(row.owner_id),
    routineScheduleId: row.routine_schedule_id
      ? asId<"routine-schedule">(row.routine_schedule_id)
      : null,
    sessionId: asId<"runtime-session">(row.session_id),
    runId: asId<"session-run">(row.run_id),
    subject: row.subject,
    status: row.status,
    output: row.output,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    documentId: row.document_id ? asId<"content">(row.document_id) : null,
    notificationId: row.notification_id
      ? asId<"notification-delivery">(row.notification_id)
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const rowSelect = `
  select id, owner_id, routine_schedule_id, session_id, run_id, subject,
         status, output, error_code, error_message, document_id,
         notification_id, created_at, updated_at
  from routine_results
`;
const returningColumns = `
  id, owner_id, routine_schedule_id, session_id, run_id, subject, status,
  output, error_code, error_message, document_id, notification_id,
  created_at, updated_at
`;

export function createRoutineResultRepository(sql: Sql) {
  async function complete(
    input: z.input<typeof resultInput> & {
      output: Record<string, unknown>;
      documentId?: Id<"content"> | null;
      notificationId?: Id<"notification-delivery"> | null;
    },
  ): Promise<RoutineResult> {
    const value = resultInput
      .extend({
        output: outputSchema,
        documentId: idSchema.nullable().optional(),
        notificationId: idSchema.nullable().optional(),
      })
      .parse(input);
    const resultId = newId<"routine-result">();
    const rows = await sql<Row[]>`
      insert into routine_results
        (id, owner_id, routine_schedule_id, session_id, run_id, subject, status,
         output, document_id, notification_id)
      values
        (${resultId}, ${value.ownerId}, ${value.routineScheduleId}, ${value.sessionId},
         ${value.runId}, ${value.subject}, 'completed', ${sql.json(value.output)},
         ${value.documentId ?? null}, ${value.notificationId ?? null})
      on conflict (owner_id, run_id) do update set updated_at=now()
      returning ${sql.unsafe(returningColumns)}
    `;
    if (rows[0] !== undefined) return safe(rows[0]);
    const [existing] = await sql<
      Row[]
    >`${sql.unsafe(rowSelect)} where owner_id=${value.ownerId} and run_id=${value.runId}`;
    if (existing === undefined)
      throw new Error(
        "ROUTINE_RESULT_NOT_FOUND: idempotent result disappeared.",
      );
    return safe(existing);
  }

  async function fail(
    input: z.input<typeof resultInput> & {
      errorCode: string;
      errorMessage: string;
    },
  ): Promise<RoutineResult> {
    const value = resultInput
      .extend({
        errorCode: z.string().trim().min(1),
        errorMessage: z.string().trim().min(1),
      })
      .parse(input);
    const resultId = newId<"routine-result">();
    const rows = await sql<Row[]>`
      insert into routine_results
        (id, owner_id, routine_schedule_id, session_id, run_id, subject, status,
         error_code, error_message)
      values
        (${resultId}, ${value.ownerId}, ${value.routineScheduleId}, ${value.sessionId},
         ${value.runId}, ${value.subject}, 'failed', ${value.errorCode}, ${value.errorMessage})
      on conflict (owner_id, run_id) do update set updated_at=now()
      returning ${sql.unsafe(returningColumns)}
    `;
    if (rows[0] !== undefined) return safe(rows[0]);
    const [existing] = await sql<
      Row[]
    >`${sql.unsafe(rowSelect)} where owner_id=${value.ownerId} and run_id=${value.runId}`;
    if (existing === undefined)
      throw new Error(
        "ROUTINE_RESULT_NOT_FOUND: idempotent result disappeared.",
      );
    return safe(existing);
  }

  async function listForSession(
    ownerId: Id<"user">,
    sessionId: Id<"runtime-session">,
    limit = 50,
  ): Promise<RoutineResult[]> {
    const value = z
      .object({
        ownerId: idSchema,
        sessionId: idSchema,
        limit: z.number().int().min(1).max(100),
      })
      .parse({ ownerId, sessionId, limit });
    const rows = await sql<Row[]>`
      ${sql.unsafe(rowSelect)}
      where owner_id=${value.ownerId} and session_id=${value.sessionId}
      order by created_at desc, id desc limit ${value.limit}
    `;
    return rows.map(safe);
  }

  return { complete, fail, listForSession };
}

export type RoutineResultRepository = ReturnType<
  typeof createRoutineResultRepository
>;
