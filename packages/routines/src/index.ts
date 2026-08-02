import type { Sql } from "postgres";
import { z } from "zod";
import { asId, newId, type Id } from "@town/contracts";

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
export class RoutineError extends Error {
  constructor(
    readonly code: "ROUTINE_NOT_FOUND" | "ROUTINE_CONFLICT",
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
  return { create, list, claimDue };
}
export type RoutineRepository = ReturnType<typeof createRoutineRepository>;
