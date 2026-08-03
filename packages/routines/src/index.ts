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
export const routineTriggerKindSchema = z.enum([
  "manual",
  "schedule",
  "incoming_email",
  "outgoing_email",
  "email_to_assistant",
  "calendar_start",
  "calendar_end",
  "calendar_rsvp",
  "calendar_changed",
  "voice_transcribed",
  "slack_mention",
  "webhook",
]);
export interface RoutineTrigger {
  id: Id<"routine-trigger">;
  ownerId: Id<"user">;
  routineScheduleId: Id<"routine-schedule">;
  kind: z.infer<typeof routineTriggerKindSchema>;
  config: Record<string, unknown>;
  enabled: boolean;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface WebhookDelivery {
  runId: Id<"integration-sync-run">;
  duplicate: boolean;
}
export interface RoutineShare {
  id: Id<"routine-share">;
  ownerId: Id<"user">;
  routineScheduleId: Id<"routine-schedule">;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}
export interface PublicRoutineShare {
  shareId: Id<"routine-share">;
  routine: Pick<
    RoutineSchedule,
    "id" | "name" | "cron" | "timezone" | "enabled"
  >;
  version: {
    id: Id<"agent-version">;
    version: number;
    snapshot: {
      displayName: string;
      instructions: string;
      defaultApprovalMode:
        "respect_tool_setting" | "require_approval" | "autonomous";
      callableRoutineIds: string[];
    };
  };
  expiresAt: Date | null;
}
export interface InstalledRoutineShare {
  routine: RoutineSchedule;
  sourceShareId: Id<"routine-share">;
}
export class RoutineError extends Error {
  constructor(
    readonly code:
      | "ROUTINE_NOT_FOUND"
      | "ROUTINE_CONFLICT"
      | "SYNC_RUN_NOT_FOUND"
      | "SYNC_RUN_CONFLICT"
      | "SHARE_NOT_FOUND"
      | "SHARE_CONFLICT",
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
type TriggerRow = {
  id: string;
  owner_id: string;
  routine_schedule_id: string;
  kind: z.infer<typeof routineTriggerKindSchema>;
  config: Record<string, unknown>;
  enabled: boolean;
  revision: number;
  created_at: Date;
  updated_at: Date;
};
type ShareRow = {
  id: string;
  owner_id: string;
  routine_schedule_id: string;
  expires_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
};
type PublicShareRow = ShareRow & {
  name: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  version_id: string;
  version: number;
  snapshot: unknown;
};
const routineSnapshotSchema = z
  .object({
    displayName: z.string(),
    instructions: z.string(),
    defaultApprovalMode: z.enum([
      "respect_tool_setting",
      "require_approval",
      "autonomous",
    ]),
    callableRoutineIds: z.array(z.string()),
  })
  .strict();
const installShareSchema = z
  .object({
    ownerId: z.uuidv7(),
    token: z.string().startsWith("rtnshare_").min(20),
    name: nameSchema.optional(),
    nextRunAt: z.date(),
    enabled: z.boolean().default(true),
  })
  .strict();
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
function safeTrigger(row: TriggerRow): RoutineTrigger {
  return {
    id: asId<"routine-trigger">(row.id),
    ownerId: asId<"user">(row.owner_id),
    routineScheduleId: asId<"routine-schedule">(row.routine_schedule_id),
    kind: routineTriggerKindSchema.parse(row.kind),
    config: row.config,
    enabled: row.enabled,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function safeShare(row: ShareRow): RoutineShare {
  return {
    id: asId<"routine-share">(row.id),
    ownerId: asId<"user">(row.owner_id),
    routineScheduleId: asId<"routine-schedule">(row.routine_schedule_id),
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}
function safePublicShare(row: PublicShareRow): PublicRoutineShare {
  return {
    shareId: asId<"routine-share">(row.id),
    routine: {
      id: asId<"routine-schedule">(row.routine_schedule_id),
      name: row.name,
      cron: row.cron,
      timezone: row.timezone,
      enabled: row.enabled,
    },
    version: {
      id: asId<"agent-version">(row.version_id),
      version: row.version,
      snapshot: routineSnapshotSchema.parse(row.snapshot),
    },
    expiresAt: row.expires_at,
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
function isConstraint(error: unknown, name: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "constraint_name" in error &&
    error.constraint_name === name
  );
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
      set runtime_run_id=${runtimeRunId}, status='running', started_at=coalesce(started_at, now()), updated_at=now()
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
  async function reconcileRuntimeRun(input: {
    ownerId: Id<"user">;
    runtimeRunId: Id<"session-run">;
    status: "completed" | "failed";
    errorCode?: string;
  }): Promise<IntegrationSyncRun | null> {
    const code =
      input.status === "failed"
        ? z
            .string()
            .trim()
            .min(1)
            .max(120)
            .parse(input.errorCode ?? "RUNTIME_FAILURE")
        : null;
    const rows = await sql<SyncRunRow[]>`
      update integration_sync_runs
      set status=${input.status === "completed" ? "succeeded" : "failed"},
          error_code=${code}, finished_at=now(), updated_at=now()
      where owner_id=${input.ownerId} and runtime_run_id=${input.runtimeRunId}
        and status='running'
      returning *
    `;
    return rows[0] ? safeRun(rows[0]) : null;
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
  async function createTrigger(input: {
    ownerId: Id<"user">;
    routineScheduleId: Id<"routine-schedule">;
    kind: z.infer<typeof routineTriggerKindSchema>;
    config?: Record<string, unknown>;
    enabled?: boolean;
  }): Promise<RoutineTrigger> {
    const value = z
      .object({
        ownerId: z.uuidv7(),
        routineScheduleId: z.uuidv7(),
        kind: routineTriggerKindSchema,
        config: z.record(z.string(), z.json()).default({}),
        enabled: z.boolean().default(true),
      })
      .strict()
      .parse(input);
    const id = newId<"routine-trigger">();
    const rows = await sql<TriggerRow[]>`
      insert into routine_triggers
        (id, owner_id, routine_schedule_id, kind, config, enabled)
      select ${id}, ${value.ownerId}, ${value.routineScheduleId}, ${value.kind},
        ${sql.json(value.config as never)}, ${value.enabled}
      where exists (
        select 1 from routine_schedules
        where owner_id=${value.ownerId} and id=${value.routineScheduleId}
      ) returning *
    `;
    const row = rows[0];
    if (!row)
      throw new RoutineError("ROUTINE_NOT_FOUND", "The routine was not found.");
    return safeTrigger(row);
  }
  async function listTriggers(
    ownerId: Id<"user">,
    routineScheduleId: Id<"routine-schedule">,
  ): Promise<RoutineTrigger[]> {
    const rows = await sql<TriggerRow[]>`
      select * from routine_triggers
      where owner_id=${ownerId} and routine_schedule_id=${routineScheduleId}
      order by created_at, id
    `;
    return rows.map(safeTrigger);
  }
  async function updateTrigger(input: {
    ownerId: Id<"user">;
    triggerId: Id<"routine-trigger">;
    expectedRevision: number;
    config: Record<string, unknown>;
    enabled: boolean;
  }): Promise<RoutineTrigger> {
    const rows = await sql<TriggerRow[]>`
      update routine_triggers
      set config=${sql.json(input.config as never)}, enabled=${input.enabled},
        revision=revision+1, updated_at=now()
      where owner_id=${input.ownerId} and id=${input.triggerId}
        and revision=${input.expectedRevision}
      returning *
    `;
    if (!rows[0])
      throw new RoutineError(
        "ROUTINE_CONFLICT",
        "The trigger changed since it was read or was not found.",
      );
    return safeTrigger(rows[0]);
  }
  async function removeTrigger(
    ownerId: Id<"user">,
    triggerId: Id<"routine-trigger">,
    expectedRevision: number,
  ): Promise<void> {
    const result = await sql`
      delete from routine_triggers
      where owner_id=${ownerId} and id=${triggerId} and revision=${expectedRevision}
    `;
    if (result.count !== 1)
      throw new RoutineError(
        "ROUTINE_CONFLICT",
        "The trigger changed since it was read or was not found.",
      );
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
  async function createShare(input: {
    ownerId: Id<"user">;
    routineScheduleId: Id<"routine-schedule">;
    expiresAt?: Date | null;
  }): Promise<{ share: RoutineShare; token: string }> {
    const ownerId = asId<"user">(input.ownerId);
    const routineScheduleId = asId<"routine-schedule">(input.routineScheduleId);
    const expiresAt =
      input.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000);
    if (expiresAt <= new Date())
      throw new RoutineError(
        "SHARE_CONFLICT",
        "Share expiry must be in the future.",
      );
    const token = `rtnshare_${randomBytes(32).toString("base64url")}`;
    const hash = createHash("sha256").update(token).digest();
    const id = newId<"routine-share">();
    const rows = await sql<ShareRow[]>`
      insert into routine_share_grants
        (id, owner_id, routine_schedule_id, token_hash, expires_at)
      select ${id}, ${ownerId}, ${routineScheduleId}, ${hash}, ${expiresAt}
      where exists (
        select 1 from routine_schedules
        where owner_id=${ownerId} and id=${routineScheduleId}
      )
      returning id, owner_id, routine_schedule_id, expires_at, revoked_at, created_at
    `;
    if (!rows[0])
      throw new RoutineError("ROUTINE_NOT_FOUND", "The routine was not found.");
    return { share: safeShare(rows[0]), token };
  }
  async function getPublicShare(
    token: string,
  ): Promise<PublicRoutineShare | null> {
    const parsed = z.string().startsWith("rtnshare_").min(20).parse(token);
    const hash = createHash("sha256").update(parsed).digest();
    const [row] = await sql<PublicShareRow[]>`
      select share.id, share.owner_id, share.routine_schedule_id,
        share.expires_at, share.revoked_at, share.created_at,
        routine.name, routine.cron, routine.timezone, routine.enabled,
        version.id as version_id, version.version, version.snapshot
      from routine_share_grants share
      join routine_schedules routine
        on routine.owner_id=share.owner_id and routine.id=share.routine_schedule_id
      join agent_versions version
        on version.owner_id=routine.owner_id and version.agent_id=routine.agent_id
        and version.id=routine.agent_version_id
      where share.token_hash=${hash} and share.revoked_at is null
        and (share.expires_at is null or share.expires_at > now())
    `;
    return row ? safePublicShare(row) : null;
  }
  async function installShare(
    input: z.input<typeof installShareSchema>,
  ): Promise<InstalledRoutineShare> {
    const value = installShareSchema.parse(input);
    const ownerId = asId<"user">(value.ownerId);
    const tokenHash = createHash("sha256").update(value.token).digest();
    const routineId = newId<"agent">();
    const versionId = newId<"agent-version">();
    const scheduleId = newId<"routine-schedule">();
    let sourceShareId: string | undefined;
    try {
      const scheduleRows = await sql.begin(async (tx) => {
        const [source] = await tx<PublicShareRow[]>`
          select share.id, share.owner_id, share.routine_schedule_id,
            share.expires_at, share.revoked_at, share.created_at,
            routine.name, routine.cron, routine.timezone, routine.enabled,
            version.id as version_id, version.version, version.snapshot
          from routine_share_grants share
          join routine_schedules routine
            on routine.owner_id=share.owner_id and routine.id=share.routine_schedule_id
          join agent_versions version
            on version.owner_id=routine.owner_id and version.agent_id=routine.agent_id
            and version.id=routine.agent_version_id
          where share.token_hash=${tokenHash} and share.revoked_at is null
            and (share.expires_at is null or share.expires_at > now())
          for update of share
        `;
        if (!source)
          throw new RoutineError(
            "SHARE_NOT_FOUND",
            "The routine share was not found.",
          );
        sourceShareId = source.id;
        const snapshot = routineSnapshotSchema.parse(source.snapshot);
        await tx`
          insert into agents (id, owner_id, kind, active_version_id)
          values (${routineId}, ${ownerId}, 'routine', null)
        `;
        await tx`
          insert into agent_versions
            (id, owner_id, agent_id, version, snapshot, change_reason, created_by)
          values
            (${versionId}, ${ownerId}, ${routineId}, 1,
             ${tx.json({ ...snapshot, callableRoutineIds: [] })},
             'Installed from shared Routine', 'user')
        `;
        await tx`
          update agents set active_version_id=${versionId}, updated_at=now()
          where owner_id=${ownerId} and id=${routineId}
        `;
        return tx<Row[]>`
          insert into routine_schedules
            (id, owner_id, agent_id, agent_version_id, name, cron, timezone,
             next_run_at, enabled)
          values
            (${scheduleId}, ${ownerId}, ${routineId}, ${versionId},
             ${value.name ?? source.name}, ${source.cron}, ${source.timezone},
             ${value.nextRunAt}, ${value.enabled})
          returning *
        `;
      });
      const row = scheduleRows[0];
      if (!row)
        throw new RoutineError(
          "ROUTINE_CONFLICT",
          "The installed routine could not be created.",
        );
      if (sourceShareId === undefined)
        throw new RoutineError(
          "SHARE_NOT_FOUND",
          "The routine share was not found.",
        );
      return {
        routine: safe(row),
        sourceShareId: asId<"routine-share">(sourceShareId),
      };
    } catch (error) {
      if (isConstraint(error, "routine_schedules_owner_name_unique"))
        throw new RoutineError(
          "ROUTINE_CONFLICT",
          "A routine with this name already exists.",
        );
      throw error;
    }
  }
  async function revokeShare(
    ownerId: Id<"user">,
    shareId: Id<"routine-share">,
  ): Promise<void> {
    const rows = await sql<ShareRow[]>`
      update routine_share_grants set revoked_at=coalesce(revoked_at, now())
      where owner_id=${ownerId} and id=${shareId} and revoked_at is null
      returning id, owner_id, routine_schedule_id, expires_at, revoked_at, created_at
    `;
    if (!rows[0])
      throw new RoutineError(
        "SHARE_NOT_FOUND",
        "The routine share was not found.",
      );
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
    reconcileRuntimeRun,
    createWebhook,
    createTrigger,
    listTriggers,
    updateTrigger,
    removeTrigger,
    getWebhook,
    setWebhookEnabled,
    deliverWebhook,
    createShare,
    getPublicShare,
    installShare,
    revokeShare,
  };
}
export type RoutineRepository = ReturnType<typeof createRoutineRepository>;
