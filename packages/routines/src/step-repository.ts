import type { Sql } from "postgres";
import { z } from "zod";

import { asId, idSchema, type Id } from "@town/contracts";

const stepInput = z
  .object({
    ownerId: idSchema,
    runId: idSchema,
    stepKey: z.string().trim().min(1).max(200),
  })
  .strict();

const outputSchema = z.json();

export type RoutineStepStatus = "running" | "completed" | "failed";

export interface RoutineStepResult {
  ownerId: Id<"user">;
  runId: string;
  stepKey: string;
  status: RoutineStepStatus;
  output: unknown | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoutineStepBegin {
  acquired: boolean;
  result: RoutineStepResult;
}

type Row = {
  owner_id: string;
  run_id: string;
  step_key: string;
  status: RoutineStepStatus;
  output: unknown | null;
  error_code: string | null;
  error_message: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function safe(row: Row): RoutineStepResult {
  return {
    ownerId: asId<"user">(row.owner_id),
    runId: row.run_id,
    stepKey: row.step_key,
    status: row.status,
    output: row.output,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createRoutineStepRepository(sql: Sql) {
  async function get(
    input: z.input<typeof stepInput>,
  ): Promise<RoutineStepResult | null> {
    const value = stepInput.parse(input);
    const [row] = await sql<Row[]>`
      select * from routine_step_results
      where owner_id=${value.ownerId} and run_id=${value.runId} and step_key=${value.stepKey}
    `;
    return row === undefined ? null : safe(row);
  }

  /** Claims a step once. Completed results are reusable; failed steps may be retried atomically. */
  async function begin(
    input: z.input<typeof stepInput>,
  ): Promise<RoutineStepBegin> {
    const value = stepInput.parse(input);
    const now = new Date();
    const rows = await sql<Row[]>`
      insert into routine_step_results
        (owner_id, run_id, step_key, status, started_at, updated_at)
      values (${value.ownerId}, ${value.runId}, ${value.stepKey}, 'running', ${now}, ${now})
      on conflict (owner_id, run_id, step_key) do nothing
      returning *
    `;
    if (rows[0] !== undefined) return { acquired: true, result: safe(rows[0]) };
    const existing = await get(value);
    if (existing === null)
      throw new Error("ROUTINE_STEP_NOT_FOUND: step claim disappeared.");
    if (existing.status === "failed") {
      const retried = await sql<Row[]>`
        update routine_step_results
        set status='running', output=null, error_code=null, error_message=null,
            started_at=now(), finished_at=null, updated_at=now()
        where owner_id=${value.ownerId} and run_id=${value.runId} and step_key=${value.stepKey}
          and status='failed'
        returning *
      `;
      if (retried[0] !== undefined)
        return { acquired: true, result: safe(retried[0]) };
      const raced = await get(value);
      if (raced !== null) return { acquired: false, result: raced };
      throw new Error("ROUTINE_STEP_NOT_FOUND: step claim disappeared.");
    }
    return { acquired: false, result: existing };
  }

  async function complete(
    input: z.input<typeof stepInput> & { output: unknown },
  ): Promise<RoutineStepResult> {
    const value = stepInput.extend({ output: outputSchema }).parse(input);
    const rows = await sql<Row[]>`
      update routine_step_results
      set status='completed', output=${sql.json(value.output)}, error_code=null,
          error_message=null, finished_at=now(), updated_at=now()
      where owner_id=${value.ownerId} and run_id=${value.runId} and step_key=${value.stepKey}
        and status='running'
      returning *
    `;
    if (rows[0] === undefined)
      throw new Error("ROUTINE_STEP_NOT_RUNNING: cannot complete step.");
    return safe(rows[0]);
  }

  async function fail(
    input: z.input<typeof stepInput> & {
      errorCode: string;
      errorMessage: string;
    },
  ): Promise<RoutineStepResult> {
    const value = stepInput
      .extend({
        errorCode: z.string().trim().min(1),
        errorMessage: z.string().trim().min(1),
      })
      .parse(input);
    const rows = await sql<Row[]>`
      update routine_step_results
      set status='failed', error_code=${value.errorCode}, error_message=${value.errorMessage},
          finished_at=now(), updated_at=now()
      where owner_id=${value.ownerId} and run_id=${value.runId} and step_key=${value.stepKey}
        and status='running'
      returning *
    `;
    if (rows[0] === undefined)
      throw new Error("ROUTINE_STEP_NOT_RUNNING: cannot fail step.");
    return safe(rows[0]);
  }

  return { get, begin, complete, fail };
}

export type RoutineStepRepository = ReturnType<
  typeof createRoutineStepRepository
>;
