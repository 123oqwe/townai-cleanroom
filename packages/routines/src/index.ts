import type { Sql } from "postgres";
import { z } from "zod";
import { asId, newId, type Id } from "@town/contracts";

export * from "./step-repository.js";

const cronSchema = z
  .string()
  .trim()
  .regex(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/, "cron must contain five fields");
const nameSchema = z.string().trim().min(1).max(120);
const scheduleInput = z
  .object({
    ownerId: z.uuidv7(),
    agentId: z.uuidv7(),
    agentVersionId: z.uuidv7(),
    name: nameSchema,
    cron: cronSchema,
    timezone: z.string().trim().min(1).max(100).default("UTC"),
    nextRunAt: z.date(),
    enabled: z.boolean().default(true),
  })
  .strict();
const updateScheduleInput = z
  .object({
    ownerId: z.uuidv7(),
    id: z.uuidv7(),
    expectedRevision: z.number().int().positive(),
    name: nameSchema,
    cron: cronSchema,
    timezone: z.string().trim().min(1).max(100).default("UTC"),
    nextRunAt: z.date(),
    enabled: z.boolean(),
  })
  .strict();

export interface RoutineSchedule {
  id: Id<"routine-schedule">;
  ownerId: Id<"user">;
  agentId: Id<"agent">;
  agentVersionId: Id<"agent-version">;
  name: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  nextRunAt: Date;
  lastRunAt: Date | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface DueRoutine extends RoutineSchedule {
  claimId: Id<"integration-sync-run">;
}
export type SyncRunStatus =
  "queued" | "running" | "succeeded" | "failed" | "blocked";
export interface IntegrationSyncRun {
  id: Id<"integration-sync-run">;
  ownerId: Id<"user">;
  accountId: Id<"connected-account">;
  routineScheduleId: Id<"routine-schedule"> | null;
  provider: string;
  status: SyncRunStatus;
  cursor: Record<string, unknown>;
  errorCode: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export class RoutineError extends Error {
  constructor(
    readonly code:
      | "ROUTINE_NOT_FOUND"
      | "ROUTINE_CONFLICT"
      | "SYNC_RUN_NOT_FOUND"
      | "SYNC_RUN_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "RoutineError";
  }
}
type Row = {
  id: string;
  owner_id: string;
  agent_id: string;
  agent_version_id: string;
  name: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  next_run_at: Date;
  last_run_at: Date | null;
  revision: number;
  created_at: Date;
  updated_at: Date;
};
type SyncRunRow = {
  id: string;
  owner_id: string;
  account_id: string;
  routine_schedule_id: string | null;
  provider: string;
  status: SyncRunStatus;
  cursor: Record<string, unknown>;
  error_code: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
};
function safeRun(row: SyncRunRow): IntegrationSyncRun {
  return {
    id: asId<"integration-sync-run">(row.id),
    ownerId: asId<"user">(row.owner_id),
    accountId: asId<"connected-account">(row.account_id),
    routineScheduleId: row.routine_schedule_id
      ? asId<"routine-schedule">(row.routine_schedule_id)
      : null,
    provider: row.provider,
    status: row.status,
    cursor: row.cursor,
    errorCode: row.error_code,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function safe(row: Row): RoutineSchedule {
  return {
    id: asId<"routine-schedule">(row.id),
    ownerId: asId<"user">(row.owner_id),
    agentId: asId<"agent">(row.agent_id),
    agentVersionId: asId<"agent-version">(row.agent_version_id),
    name: row.name,
    cron: row.cron,
    timezone: row.timezone,
    enabled: row.enabled,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createRoutineRepository(sql: Sql) {
  async function create(
    input: z.input<typeof scheduleInput>,
  ): Promise<RoutineSchedule> {
    const value = scheduleInput.parse(input);
    const id = newId<"routine-schedule">();
    try {
      const rows = await sql<
        Row[]
      >`insert into routine_schedules (id, owner_id, agent_id, agent_version_id, name, cron, timezone, next_run_at, enabled) select ${id}, ${value.ownerId}, ${value.agentId}, ${value.agentVersionId}, ${value.name}, ${value.cron}, ${value.timezone}, ${value.nextRunAt}, ${value.enabled} where exists (select 1 from agents where owner_id=${value.ownerId} and id=${value.agentId} and kind='routine' and status='active') and exists (select 1 from agent_versions where owner_id=${value.ownerId} and agent_id=${value.agentId} and id=${value.agentVersionId}) returning *`;
      if (!rows[0])
        throw new RoutineError(
          "ROUTINE_NOT_FOUND",
          "The routine agent or version was not found.",
        );
      return safe(rows[0]);
    } catch (error) {
      if (
        typeof error === "object" &&
        error &&
        "constraint_name" in error &&
        error.constraint_name === "routine_schedules_owner_name_unique"
      )
        throw new RoutineError(
          "ROUTINE_CONFLICT",
          "A routine with this name already exists.",
        );
      throw error;
    }
  }
  async function list(ownerId: Id<"user">): Promise<RoutineSchedule[]> {
    const rows = await sql<
      Row[]
    >`select * from routine_schedules where owner_id=${ownerId} order by next_run_at, id`;
    return rows.map(safe);
  }
  async function update(
    input: z.input<typeof updateScheduleInput>,
  ): Promise<RoutineSchedule> {
    const value = updateScheduleInput.parse(input);
    const rows = await sql.begin(async (transaction) => {
      const [current] = await transaction<{ revision: number }[]>`
        select revision from routine_schedules
        where owner_id=${value.ownerId} and id=${value.id}
        for update
      `;
      if (current === undefined)
        throw new RoutineError(
          "ROUTINE_NOT_FOUND",
          "The routine was not found.",
        );
      if (current.revision !== value.expectedRevision)
        throw new RoutineError(
          "ROUTINE_CONFLICT",
          "The routine changed since it was read.",
        );
      return transaction<Row[]>`
        update routine_schedules
        set name=${value.name}, cron=${value.cron}, timezone=${value.timezone},
            next_run_at=${value.nextRunAt}, enabled=${value.enabled},
            revision=revision+1, updated_at=now()
        where owner_id=${value.ownerId} and id=${value.id}
        returning *
      `;
    });
    const row = rows[0];
    if (row === undefined)
      throw new RoutineError("ROUTINE_NOT_FOUND", "The routine was not found.");
    return safe(row);
  }
  async function remove(
    ownerId: Id<"user">,
    routineScheduleId: Id<"routine-schedule">,
    expectedRevision: number,
  ): Promise<void> {
    const revision = z.number().int().positive().parse(expectedRevision);
    await sql.begin(async (transaction) => {
      const [current] = await transaction<{ revision: number }[]>`
        select revision from routine_schedules
        where owner_id=${ownerId} and id=${routineScheduleId}
        for update
      `;
      if (current === undefined)
        throw new RoutineError(
          "ROUTINE_NOT_FOUND",
          "The routine was not found.",
        );
      if (current.revision !== revision)
        throw new RoutineError(
          "ROUTINE_CONFLICT",
          "The routine changed since it was read.",
        );
      const [history] = await transaction<{ count: number }[]>`
        select count(*)::int as count from integration_sync_runs
        where owner_id=${ownerId} and routine_schedule_id=${routineScheduleId}
      `;
      if ((history?.count ?? 0) > 0)
        throw new RoutineError(
          "ROUTINE_CONFLICT",
          "A routine with run history cannot be deleted; disable it instead.",
        );
      await transaction`
        delete from routine_schedules
        where owner_id=${ownerId} and id=${routineScheduleId}
      `;
    });
  }
  async function ownsSchedule(
    ownerId: Id<"user">,
    routineScheduleId: Id<"routine-schedule">,
  ): Promise<boolean> {
    const [row] = await sql<{ id: string }[]>`
      select id from routine_schedules
      where owner_id=${ownerId} and id=${routineScheduleId}
    `;
    return row !== undefined;
  }
  async function claimDue(
    ownerId: Id<"user">,
    now = new Date(),
  ): Promise<DueRoutine[]> {
    return sql.begin(async (tx) => {
      const rows = await tx<
        Row[]
      >`select * from routine_schedules where owner_id=${ownerId} and enabled=true and next_run_at <= ${now} order by next_run_at, id for update skip locked`;
      const claimed: DueRoutine[] = [];
      for (const row of rows) {
        const claimId = newId<"integration-sync-run">();
        await tx`insert into integration_sync_runs (id, owner_id, account_id, routine_schedule_id, provider, status) select ${claimId}, ${ownerId}, ca.id, ${row.id}, ca.provider, 'queued' from connected_accounts ca where ca.owner_id=${ownerId} and ca.is_active=true order by ca.is_primary desc, ca.created_at, ca.id limit 1`;
        await tx`update routine_schedules set last_run_at=${now}, next_run_at=${now} + interval '1 minute', revision=revision+1, updated_at=now() where owner_id=${ownerId} and id=${row.id}`;
        claimed.push({ ...safe(row), claimId });
      }
      return claimed;
    });
  }
  async function listRuns(
    ownerId: Id<"user">,
    routineScheduleId?: Id<"routine-schedule">,
    limit = 50,
  ): Promise<IntegrationSyncRun[]> {
    const bounded = z.number().int().min(1).max(100).parse(limit);
    const rows = routineScheduleId
      ? await sql<
          SyncRunRow[]
        >`select * from integration_sync_runs where owner_id=${ownerId} and routine_schedule_id=${routineScheduleId} order by created_at desc, id desc limit ${bounded}`
      : await sql<
          SyncRunRow[]
        >`select * from integration_sync_runs where owner_id=${ownerId} order by created_at desc, id desc limit ${bounded}`;
    return rows.map(safeRun);
  }
  async function getRun(
    ownerId: Id<"user">,
    id: Id<"integration-sync-run">,
  ): Promise<IntegrationSyncRun> {
    const [row] = await sql<
      SyncRunRow[]
    >`select * from integration_sync_runs where owner_id=${ownerId} and id=${id}`;
    if (!row)
      throw new RoutineError(
        "SYNC_RUN_NOT_FOUND",
        "The sync run was not found.",
      );
    return safeRun(row);
  }
  async function startRun(
    ownerId: Id<"user">,
    id: Id<"integration-sync-run">,
  ): Promise<IntegrationSyncRun> {
    const rows = await sql<
      SyncRunRow[]
    >`update integration_sync_runs set status='running', started_at=coalesce(started_at, now()), updated_at=now() where owner_id=${ownerId} and id=${id} and status='queued' returning *`;
    if (!rows[0]) {
      await getRun(ownerId, id);
      throw new RoutineError(
        "SYNC_RUN_CONFLICT",
        "The sync run is not queued.",
      );
    }
    return safeRun(rows[0]);
  }
  async function completeRun(
    ownerId: Id<"user">,
    id: Id<"integration-sync-run">,
    cursor: Record<string, unknown> = {},
  ): Promise<IntegrationSyncRun> {
    const parsed = z.record(z.string(), z.unknown()).parse(cursor);
    const rows = await sql<
      SyncRunRow[]
    >`update integration_sync_runs set status='succeeded', cursor=${sql.json(parsed as never)}, finished_at=now(), updated_at=now() where owner_id=${ownerId} and id=${id} and status='running' returning *`;
    if (!rows[0]) {
      await getRun(ownerId, id);
      throw new RoutineError(
        "SYNC_RUN_CONFLICT",
        "The sync run is not running.",
      );
    }
    return safeRun(rows[0]);
  }
  async function failRun(
    ownerId: Id<"user">,
    id: Id<"integration-sync-run">,
    errorCode: string,
  ): Promise<IntegrationSyncRun> {
    const code = z.string().trim().min(1).max(120).parse(errorCode);
    const rows = await sql<
      SyncRunRow[]
    >`update integration_sync_runs set status='failed', error_code=${code}, finished_at=now(), updated_at=now() where owner_id=${ownerId} and id=${id} and status='running' returning *`;
    if (!rows[0]) {
      await getRun(ownerId, id);
      throw new RoutineError(
        "SYNC_RUN_CONFLICT",
        "The sync run is not running.",
      );
    }
    return safeRun(rows[0]);
  }
  return {
    create,
    list,
    update,
    remove,
    ownsSchedule,
    claimDue,
    listRuns,
    getRun,
    startRun,
    completeRun,
    failRun,
  };
}
export type RoutineRepository = ReturnType<typeof createRoutineRepository>;
