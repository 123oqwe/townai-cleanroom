import { createHash, randomBytes } from "node:crypto";
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
  runtimeRunId: Id<"session-run"> | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface RoutineWebhook {
  id: Id<"routine-webhook">;
  ownerId: Id<"user">;
  routineScheduleId: Id<"routine-schedule">;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
export interface WebhookDelivery {
  runId: Id<"integration-sync-run">;
  duplicate: boolean;
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
  runtime_run_id: string | null;
  created_at: Date;
  updated_at: Date;
};
type WebhookRow = {
  id: string;
  owner_id: string;
  routine_schedule_id: string;
  enabled: boolean;
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
    runtimeRunId: row.runtime_run_id
      ? asId<"session-run">(row.runtime_run_id)
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function safeWebhook(row: WebhookRow): RoutineWebhook {
  return {
    id: asId<"routine-webhook">(row.id),
    ownerId: asId<"user">(row.owner_id),
    routineScheduleId: asId<"routine-schedule">(row.routine_schedule_id),
    enabled: row.enabled,
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
  async function get(
    ownerId: Id<"user">,
    routineScheduleId: Id<"routine-schedule">,
  ): Promise<RoutineSchedule> {
    const [row] = await sql<Row[]>`
      select * from routine_schedules where owner_id=${ownerId} and id=${routineScheduleId}
    `;
    if (!row)
      throw new RoutineError("ROUTINE_NOT_FOUND", "The routine was not found.");
    return safe(row);
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
  async function attachRuntimeRun(
    ownerId: Id<"user">,
    id: Id<"integration-sync-run">,
    runtimeRunId: Id<"session-run">,
  ): Promise<IntegrationSyncRun> {
    const rows = await sql<SyncRunRow[]>`
      update integration_sync_runs
      set runtime_run_id=${runtimeRunId}, updated_at=now()
      where owner_id=${ownerId} and id=${id}
        and status='queued' and runtime_run_id is null
      returning *
    `;
    if (!rows[0]) {
      await getRun(ownerId, id);
      throw new RoutineError(
        "SYNC_RUN_CONFLICT",
        "The sync run is already linked or not queued.",
      );
    }
    return safeRun(rows[0]);
  }
  async function createWebhook(
    ownerId: Id<"user">,
    routineScheduleId: Id<"routine-schedule">,
  ): Promise<{ webhook: RoutineWebhook; secret: string }> {
    const secret = `whsec_${randomBytes(32).toString("base64url")}`;
    const hash = createHash("sha256").update(secret).digest();
    const id = newId<"routine-webhook">();
    const rows = await sql<WebhookRow[]>`
      insert into routine_webhooks (id, owner_id, routine_schedule_id, token_hash)
      select ${id}, ${ownerId}, ${routineScheduleId}, ${hash}
      where exists (select 1 from routine_schedules where owner_id=${ownerId} and id=${routineScheduleId})
      on conflict (owner_id, routine_schedule_id) do update
        set token_hash=excluded.token_hash, enabled=true, updated_at=now()
      returning *
    `;
    if (!rows[0])
      throw new RoutineError("ROUTINE_NOT_FOUND", "The routine was not found.");
    return { webhook: safeWebhook(rows[0]), secret };
  }
  async function getWebhook(
    ownerId: Id<"user">,
    routineScheduleId: Id<"routine-schedule">,
  ): Promise<RoutineWebhook | null> {
    const [row] = await sql<WebhookRow[]>`
      select * from routine_webhooks where owner_id=${ownerId} and routine_schedule_id=${routineScheduleId}
    `;
    return row ? safeWebhook(row) : null;
  }
  async function setWebhookEnabled(
    ownerId: Id<"user">,
    routineScheduleId: Id<"routine-schedule">,
    enabled: boolean,
  ): Promise<RoutineWebhook> {
    const rows = await sql<WebhookRow[]>`
      update routine_webhooks set enabled=${z.boolean().parse(enabled)}, updated_at=now()
      where owner_id=${ownerId} and routine_schedule_id=${routineScheduleId} returning *
    `;
    if (!rows[0])
      throw new RoutineError(
        "ROUTINE_NOT_FOUND",
        "The routine webhook was not found.",
      );
    return safeWebhook(rows[0]);
  }
  async function deliverWebhook(
    secret: string,
    idempotencyKey: string,
    payload: Record<string, unknown>,
  ): Promise<WebhookDelivery | null> {
    const parsedSecret = z.string().startsWith("whsec_").min(20).parse(secret);
    const key = z.string().trim().min(1).max(500).parse(idempotencyKey);
    const body = z.record(z.string(), z.unknown()).parse(payload);
    const hash = createHash("sha256").update(parsedSecret).digest();
    return sql.begin(async (tx) => {
      const [webhook] = await tx<WebhookRow[]>`
        select * from routine_webhooks where token_hash=${hash} and enabled=true for update
      `;
      if (!webhook) return null;
      const [existing] = await tx<{ run_id: string }[]>`
        select run_id from routine_webhook_deliveries where webhook_id=${webhook.id} and idempotency_key=${key}
      `;
      if (existing)
        return {
          runId: asId<"integration-sync-run">(existing.run_id),
          duplicate: true,
        };
      const [run] = await tx<{ id: string }[]>`
        insert into integration_sync_runs (id,owner_id,account_id,routine_schedule_id,provider,status,cursor)
        select ${newId<"integration-sync-run">()}, ${webhook.owner_id}, ca.id,
          ${webhook.routine_schedule_id}, ca.provider, 'queued', ${tx.json(body as never)}
        from connected_accounts ca where ca.owner_id=${webhook.owner_id} and ca.is_active=true
        order by ca.is_primary desc, ca.created_at, ca.id limit 1 returning id
      `;
      if (!run)
        throw new RoutineError(
          "ROUTINE_CONFLICT",
          "No active connected account is available for this webhook.",
        );
      await tx`
        insert into routine_webhook_deliveries (id,owner_id,webhook_id,idempotency_key,payload,run_id)
        values (${newId<"routine-webhook-delivery">()},${webhook.owner_id},${webhook.id},${key},${tx.json(body as never)},${run.id})
      `;
      return { runId: asId<"integration-sync-run">(run.id), duplicate: false };
    });
  }
  return {
    create,
    list,
    get,
    update,
    remove,
    ownsSchedule,
    claimDue,
    listRuns,
    getRun,
    startRun,
    completeRun,
    failRun,
    attachRuntimeRun,
    createWebhook,
    getWebhook,
    setWebhookEnabled,
    deliverWebhook,
  };
}
export type RoutineRepository = ReturnType<typeof createRoutineRepository>;
