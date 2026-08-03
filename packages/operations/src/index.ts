import type { Sql } from "postgres";
import { z } from "zod";

import { asId, idSchema, newId, type Id } from "@town/contracts";

export const auditOutcomeSchema = z.enum(["succeeded", "failed"]);
export type AuditOutcome = z.infer<typeof auditOutcomeSchema>;

export interface AuditEvent {
  id: Id<"operation-audit-event">;
  ownerId: Id<"user">;
  actorId: Id<"user"> | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: AuditOutcome;
  requestId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}
export interface AuditPage {
  items: AuditEvent[];
  nextCursor: string | null;
}
export interface TimelineItem {
  kind: "delivery" | "audit";
  id: string;
  createdAt: Date;
  data: Record<string, unknown>;
}
export interface TimelinePage {
  items: TimelineItem[];
  nextCursor: string | null;
}
export interface AnalyticsEvent {
  id: Id<"operation-analytics-event">;
  ownerId: Id<"user">;
  eventName: string;
  metadata: Record<string, unknown>;
  dedupeKey: string | null;
  createdAt: Date;
}
export interface AnalyticsPage {
  items: AnalyticsEvent[];
  nextCursor: string | null;
}
export interface PublicAnalyticsReceipt {
  accepted: true;
  replayed: boolean;
}
export const presenceSurfaceSchema = z.enum([
  "web",
  "ios",
  "macos",
  "email",
  "slack",
  "whatsapp",
  "telegram",
  "imessage",
]);
export type PresenceSurface = z.infer<typeof presenceSurfaceSchema>;
export interface PresenceSession {
  id: Id<"presence-session">;
  ownerId: Id<"user">;
  sessionId: string;
  surface: PresenceSurface;
  clientSha: string | null;
  deploymentTime: Date | null;
  userAgent: string | null;
  lastSeenAt: Date;
  expiresAt: Date;
  createdAt: Date;
}
export interface OperationSummary {
  activeSessions: number;
  queuedRuns: number;
  failedRuns: number;
  pendingApprovals: number;
  queuedDeliveries: number;
  failedDeliveries: number;
}
export class OperationsError extends Error {
  constructor(
    readonly code: "AUDIT_CONFLICT" | "INVALID_CURSOR" | "INVALID_METADATA",
    message: string,
  ) {
    super(message);
    this.name = "OperationsError";
  }
}

type AuditRow = {
  id: string;
  owner_id: string;
  actor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  outcome: AuditOutcome;
  request_id: string | null;
  dedupe_key: string | null;
  fingerprint: string;
  metadata: Record<string, unknown>;
  created_at: Date;
};
type AnalyticsRow = {
  id: string;
  owner_id: string;
  event_name: string;
  metadata: Record<string, unknown>;
  dedupe_key: string | null;
  fingerprint: string;
  created_at: Date;
};
type PublicAnalyticsRow = {
  id: string;
  session_key: string;
  event_name: string;
  metadata: Record<string, unknown>;
  dedupe_key: string | null;
  fingerprint: string;
  created_at: Date;
};
type PresenceRow = {
  id: string;
  owner_id: string;
  session_id: string;
  surface: PresenceSurface;
  client_sha: string | null;
  deployment_time: Date | null;
  user_agent: string | null;
  last_seen_at: Date;
  expires_at: Date;
  created_at: Date;
};
const appendSchema = z
  .object({
    ownerId: idSchema,
    actorId: idSchema.nullable().optional(),
    action: z.string().trim().min(1).max(200),
    resourceType: z.string().trim().min(1).max(100),
    resourceId: z.string().trim().min(1).max(500).nullable().optional(),
    outcome: auditOutcomeSchema.default("succeeded"),
    requestId: z.string().trim().min(1).max(500).nullable().optional(),
    dedupeKey: z.string().trim().min(1).max(500).nullable().optional(),
    metadata: z.record(z.string(), z.json()).default({}),
  })
  .strict();
const listSchema = z
  .object({
    ownerId: idSchema,
    action: z.string().trim().min(1).max(200).optional(),
    outcome: auditOutcomeSchema.optional(),
    cursor: z.string().min(1).max(500).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
const analyticsAppendSchema = z
  .object({
    ownerId: idSchema,
    eventName: z.string().trim().min(1).max(200),
    metadata: z.record(z.string(), z.json()).default({}),
    dedupeKey: z.string().trim().min(1).max(500).nullable().optional(),
  })
  .strict();
const analyticsListSchema = z
  .object({
    ownerId: idSchema,
    eventName: z.string().trim().min(1).max(200).optional(),
    cursor: z.string().min(1).max(500).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
const publicAnalyticsSchema = z
  .object({
    sessionKey: z.string().trim().min(16).max(128),
    eventName: z.string().trim().min(1).max(200),
    metadata: z.record(z.string(), z.json()).default({}),
    dedupeKey: z.string().trim().min(1).max(500).nullable().optional(),
  })
  .strict();
const presenceHeartbeatSchema = z
  .object({
    ownerId: idSchema,
    sessionId: z.string().trim().min(1).max(200),
    surface: presenceSurfaceSchema,
    clientSha: z.string().trim().min(1).max(200).nullable().optional(),
    deploymentTime: z.coerce.date().nullable().optional(),
    userAgent: z.string().trim().max(1_000).nullable().optional(),
    intervalSeconds: z.number().int().min(5).max(120).default(30),
  })
  .strict();
const sensitiveKey =
  /(authorization|cookie|credential|password|private[_-]?key|refresh[_-]?token|secret|token|api[_-]?key)/i;
function safeMetadata(value: Record<string, unknown>): Record<string, unknown> {
  function visit(input: unknown, depth: number): unknown {
    if (depth > 5)
      throw new OperationsError(
        "INVALID_METADATA",
        "Audit metadata is too deeply nested.",
      );
    if (Array.isArray(input))
      return input.map((entry) => visit(entry, depth + 1));
    if (input !== null && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>).map(([key, entry]) => {
          if (sensitiveKey.test(key))
            throw new OperationsError(
              "INVALID_METADATA",
              "Audit metadata contains a sensitive key.",
            );
          return [key, visit(entry, depth + 1)];
        }),
      );
    }
    return input;
  }
  const result = visit(value, 0) as Record<string, unknown>;
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 16_384)
    throw new OperationsError(
      "INVALID_METADATA",
      "Audit metadata exceeds the 16 KiB limit.",
    );
  return result;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}
function fingerprint(value: {
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: AuditOutcome;
  requestId: string | null;
  metadata: Record<string, unknown>;
}): string {
  return JSON.stringify(canonical(value));
}
type Cursor = { createdAt: Date; id: string };
function encodeCursor(cursor: Cursor): string {
  return Buffer.from(
    JSON.stringify({ at: cursor.createdAt.toISOString(), id: cursor.id }),
  ).toString("base64url");
}
function decodeCursor(value: string): Cursor {
  try {
    const parsed = z
      .object({ at: z.iso.datetime(), id: z.uuidv7() })
      .strict()
      .parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    return { createdAt: new Date(parsed.at), id: parsed.id };
  } catch {
    throw new OperationsError("INVALID_CURSOR", "The audit cursor is invalid.");
  }
}
function safeAudit(row: AuditRow): AuditEvent {
  return {
    id: asId<"operation-audit-event">(row.id),
    ownerId: asId<"user">(row.owner_id),
    actorId: row.actor_id ? asId<"user">(row.actor_id) : null,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    outcome: row.outcome,
    requestId: row.request_id,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}
function safeAnalytics(row: AnalyticsRow): AnalyticsEvent {
  return {
    id: asId<"operation-analytics-event">(row.id),
    ownerId: asId<"user">(row.owner_id),
    eventName: row.event_name,
    metadata: row.metadata,
    dedupeKey: row.dedupe_key,
    createdAt: row.created_at,
  };
}
function publicAnalyticsFingerprint(value: {
  eventName: string;
  metadata: Record<string, unknown>;
}): string {
  return JSON.stringify(canonical(value));
}
function safePresence(row: PresenceRow): PresenceSession {
  return {
    id: asId<"presence-session">(row.id),
    ownerId: asId<"user">(row.owner_id),
    sessionId: row.session_id,
    surface: row.surface,
    clientSha: row.client_sha,
    deploymentTime: row.deployment_time,
    userAgent: row.user_agent,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export function createOperationsRepository(sql: Sql) {
  async function append(
    input: z.input<typeof appendSchema>,
  ): Promise<AuditEvent> {
    const value = appendSchema.parse(input);
    const dedupeKey = value.dedupeKey ?? null;
    const metadata = safeMetadata(value.metadata);
    const requestFingerprint = fingerprint({
      actorId: value.actorId ?? null,
      action: value.action,
      resourceType: value.resourceType,
      resourceId: value.resourceId ?? null,
      outcome: value.outcome,
      requestId: value.requestId ?? null,
      metadata,
    });
    const [row] = await sql<AuditRow[]>`
      insert into operation_audit_events
        (id,owner_id,actor_id,action,resource_type,resource_id,outcome,request_id,dedupe_key,fingerprint,metadata)
      values
        (${newId<"operation-audit-event">()},${value.ownerId},${value.actorId ?? null},${value.action},${value.resourceType},${value.resourceId ?? null},${value.outcome},${value.requestId ?? null},${dedupeKey},${requestFingerprint},${sql.json(metadata as never)})
      on conflict (owner_id,dedupe_key) do nothing
      returning *`;
    if (row) return safeAudit(row);
    const [existing] = await sql<AuditRow[]>`
      select * from operation_audit_events
      where owner_id=${value.ownerId} and dedupe_key=${dedupeKey}`;
    if (existing && existing.fingerprint === requestFingerprint)
      return safeAudit(existing);
    throw new OperationsError(
      "AUDIT_CONFLICT",
      "The audit event conflicts with another write.",
    );
  }
  async function list(input: z.input<typeof listSchema>): Promise<AuditPage> {
    const value = listSchema.parse(input);
    const cursor =
      value.cursor === undefined ? null : decodeCursor(value.cursor);
    const actionFilter =
      value.action === undefined ? sql`` : sql`and action=${value.action}`;
    const outcomeFilter =
      value.outcome === undefined ? sql`` : sql`and outcome=${value.outcome}`;
    const cursorFilter =
      cursor === null
        ? sql``
        : sql`and (created_at,id) < (${cursor.createdAt},${cursor.id})`;
    const rows = await sql<AuditRow[]>`
      select * from operation_audit_events
      where owner_id=${value.ownerId}
        ${actionFilter}
        ${outcomeFilter}
        ${cursorFilter}
      order by created_at desc, id desc
      limit ${value.limit + 1}`;
    const hasMore = rows.length > value.limit;
    const items = rows.slice(0, value.limit).map(safeAudit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    };
  }
  async function summary(ownerId: Id<"user">): Promise<OperationSummary> {
    const [row] = await sql<
      {
        active_sessions: number;
        queued_runs: number;
        failed_runs: number;
        pending_approvals: number;
        queued_deliveries: number;
        failed_deliveries: number;
      }[]
    >`
      select
        (select count(*) from runtime_sessions where owner_id=${ownerId} and state in ('running','waiting_approval','waiting_user_input'))::int as active_sessions,
        (select count(*) from session_runs where owner_id=${ownerId} and state='queued')::int as queued_runs,
        (select count(*) from session_runs where owner_id=${ownerId} and state='failed')::int as failed_runs,
        (select count(*) from approval_requests where owner_id=${ownerId} and state='pending')::int as pending_approvals,
        (select count(*) from notification_deliveries where owner_id=${ownerId} and status in ('queued','attempting'))::int as queued_deliveries,
        (select count(*) from notification_deliveries where owner_id=${ownerId} and status='failed')::int as failed_deliveries`;
    return {
      activeSessions: row?.active_sessions ?? 0,
      queuedRuns: row?.queued_runs ?? 0,
      failedRuns: row?.failed_runs ?? 0,
      pendingApprovals: row?.pending_approvals ?? 0,
      queuedDeliveries: row?.queued_deliveries ?? 0,
      failedDeliveries: row?.failed_deliveries ?? 0,
    };
  }
  async function appendAnalytics(
    input: z.input<typeof analyticsAppendSchema>,
  ): Promise<AnalyticsEvent> {
    const value = analyticsAppendSchema.parse(input);
    const metadata = safeMetadata(value.metadata);
    const requestFingerprint = fingerprint({
      actorId: null,
      action: value.eventName,
      resourceType: "analytics_event",
      resourceId: null,
      outcome: "succeeded",
      requestId: null,
      metadata,
    });
    const [row] = await sql<AnalyticsRow[]>`
      insert into analytics_events
        (id,owner_id,event_name,metadata,dedupe_key,fingerprint)
      values
        (${newId<"operation-analytics-event">()},${value.ownerId},${value.eventName},${sql.json(metadata as never)},${value.dedupeKey ?? null},${requestFingerprint})
      on conflict (owner_id,dedupe_key) do nothing
      returning *`;
    if (row) return safeAnalytics(row);
    const [existing] = await sql<AnalyticsRow[]>`
      select * from analytics_events
      where owner_id=${value.ownerId} and dedupe_key=${value.dedupeKey ?? null}`;
    if (existing && existing.fingerprint === requestFingerprint)
      return safeAnalytics(existing);
    throw new OperationsError(
      "AUDIT_CONFLICT",
      "The analytics event conflicts with another write.",
    );
  }
  async function appendPublicAnalytics(
    input: z.input<typeof publicAnalyticsSchema>,
  ): Promise<PublicAnalyticsReceipt> {
    const value = publicAnalyticsSchema.parse(input);
    const metadata = safeMetadata(value.metadata);
    const requestFingerprint = publicAnalyticsFingerprint({
      eventName: value.eventName,
      metadata,
    });
    const [row] = await sql<PublicAnalyticsRow[]>`
      insert into public_analytics_events
        (id,session_key,event_name,metadata,dedupe_key,fingerprint)
      values
        (${newId<"public-analytics-event">()},${value.sessionKey},${value.eventName},${sql.json(metadata as never)},${value.dedupeKey ?? null},${requestFingerprint})
      on conflict (session_key,dedupe_key) do nothing
      returning id`;
    if (row) return { accepted: true, replayed: false };
    const [existing] = await sql<PublicAnalyticsRow[]>`
      select fingerprint from public_analytics_events
      where session_key=${value.sessionKey} and dedupe_key=${value.dedupeKey ?? null}`;
    if (existing?.fingerprint === requestFingerprint)
      return { accepted: true, replayed: true };
    throw new OperationsError(
      "AUDIT_CONFLICT",
      "The public analytics event conflicts with another write.",
    );
  }
  async function listAnalytics(
    input: z.input<typeof analyticsListSchema>,
  ): Promise<AnalyticsPage> {
    const value = analyticsListSchema.parse(input);
    const cursor =
      value.cursor === undefined ? null : decodeCursor(value.cursor);
    const eventFilter =
      value.eventName === undefined
        ? sql``
        : sql`and event_name=${value.eventName}`;
    const cursorFilter =
      cursor === null
        ? sql``
        : sql`and (created_at,id) < (${cursor.createdAt},${cursor.id})`;
    const rows = await sql<AnalyticsRow[]>`
      select * from analytics_events
      where owner_id=${value.ownerId} ${eventFilter} ${cursorFilter}
      order by created_at desc, id desc
      limit ${value.limit + 1}`;
    const items = rows.slice(0, value.limit).map(safeAnalytics);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > value.limit && last
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    };
  }
  async function heartbeatPresence(
    input: z.input<typeof presenceHeartbeatSchema>,
  ): Promise<PresenceSession> {
    const value = presenceHeartbeatSchema.parse(input);
    const [row] = await sql<PresenceRow[]>`
      insert into presence_sessions
        (id,owner_id,session_id,surface,client_sha,deployment_time,user_agent,last_seen_at,expires_at)
      values
        (${newId<"presence-session">()},${value.ownerId},${value.sessionId},${value.surface},${value.clientSha ?? null},${value.deploymentTime ?? null},${value.userAgent ?? null},now(),now() + (${value.intervalSeconds * 3} * interval '1 second'))
      on conflict (owner_id,session_id) do update set
        surface=excluded.surface,
        client_sha=excluded.client_sha,
        deployment_time=excluded.deployment_time,
        user_agent=excluded.user_agent,
        last_seen_at=now(),
        expires_at=excluded.expires_at
      returning *`;
    if (!row)
      throw new OperationsError(
        "AUDIT_CONFLICT",
        "Presence heartbeat was not persisted.",
      );
    return safePresence(row);
  }
  async function listPresence(ownerId: Id<"user">): Promise<PresenceSession[]> {
    const value = idSchema.parse(ownerId);
    const rows = await sql<PresenceRow[]>`
      select * from presence_sessions
      where owner_id=${value} and expires_at > now()
      order by last_seen_at desc, id desc`;
    return rows.map(safePresence);
  }
  async function timeline(input: {
    ownerId: Id<"user">;
    cursor?: string;
    limit?: number;
  }): Promise<TimelinePage> {
    const ownerId = idSchema.parse(input.ownerId);
    const limit = z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .parse(input.limit);
    const cursor =
      input.cursor === undefined ? null : decodeCursor(input.cursor);
    const cursorFilter =
      cursor === null
        ? sql``
        : sql`and (created_at,id) < (${cursor.createdAt},${cursor.id})`;
    const rows = await sql<
      {
        kind: "delivery" | "audit";
        id: string;
        created_at: Date;
        data: Record<string, unknown>;
      }[]
    >`
      select 'delivery'::text as kind, id, created_at,
        jsonb_build_object(
          'ownerId', owner_id, 'channelId', channel_id, 'eventType', event_type,
          'status', status, 'attempts', attempts, 'lastError', last_error,
          'nextAttemptAt', next_attempt_at, 'sentAt', sent_at
        ) as data
      from notification_deliveries
      where owner_id=${ownerId} ${cursorFilter}
      union all
      select 'audit'::text as kind, id, created_at,
        jsonb_build_object(
          'action', action, 'resourceType', resource_type, 'resourceId', resource_id,
          'outcome', outcome, 'requestId', request_id, 'metadata', metadata
        ) as data
      from operation_audit_events
      where owner_id=${ownerId} ${cursorFilter}
      order by created_at desc, id desc
      limit ${limit + 1}`;
    const items = rows.slice(0, limit).map((row) => ({
      kind: row.kind,
      id: row.id,
      createdAt: row.created_at,
      data: row.data,
    }));
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    };
  }
  return {
    append,
    list,
    summary,
    timeline,
    appendAnalytics,
    listAnalytics,
    appendPublicAnalytics,
    heartbeatPresence,
    listPresence,
  };
}
export type OperationsRepository = ReturnType<
  typeof createOperationsRepository
>;
