import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const citext = customType<{ data: string }>({
  dataType: () => "citext",
});

const bytea = customType<{ data: Buffer }>({
  dataType: () => "bytea",
});

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

export const accessAllowlist = pgTable("access_allowlist", {
  email: citext("email").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    email: citext("email").notNull().unique(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    timezone: text("timezone").notNull().default("UTC"),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    check(
      "users_status_allowed",
      sql`${table.status} in ('active', 'disabled')`,
    ),
  ],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: customType<{ data: Buffer }>({ dataType: () => "bytea" })(
      "token_hash",
    )
      .notNull()
      .unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("auth_sessions_user_id_idx").on(table.userId)],
);

export const oauthCredentials = pgTable(
  "oauth_credentials",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    keyVersion: integer("key_version").notNull(),
    envelope: jsonb("envelope").notNull(),
    ...timestamps,
  },
  (table) => [index("oauth_credentials_owner_id_idx").on(table.ownerId)],
);

export const connectedAccounts = pgTable(
  "connected_accounts",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
    email: citext("email").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    capabilities: jsonb("capabilities").notNull().default({}),
    credentialId: uuid("credential_id").references(() => oauthCredentials.id, {
      onDelete: "set null",
    }),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    needsReauth: boolean("needs_reauth").notNull().default(false),
    reauthBlockedByOrgPolicy: boolean("reauth_blocked_by_org_policy")
      .notNull()
      .default(false),
    ...timestamps,
  },
  (table) => [
    unique("connected_accounts_owner_id_id_unique").on(table.ownerId, table.id),
    unique("connected_accounts_owner_provider_identity_unique").on(
      table.ownerId,
      table.provider,
      table.providerUserId,
    ),
    index("connected_accounts_owner_id_idx").on(table.ownerId),
  ],
);

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: jsonb("content").notNull().default({}),
    currentRevision: integer("current_revision").notNull().default(1),
    ...timestamps,
  },
  (table) => [unique("profiles_owner_id_unique").on(table.ownerId)],
);

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    scopeId: uuid("scope_id"),
    content: text("content").notNull(),
    status: text("status").notNull().default("active"),
    confidence: real("confidence"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    currentRevision: integer("current_revision").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    index("memories_owner_scope_status_idx").on(
      table.ownerId,
      table.scope,
      table.scopeId,
      table.status,
    ),
  ],
);

export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    primaryEmail: citext("primary_email"),
    category: text("category").notNull().default("uncategorized"),
    organization: text("organization"),
    role: text("role"),
    notes: text("notes").notNull().default(""),
    status: text("status").notNull().default("active"),
    currentRevision: integer("current_revision").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    unique("people_owner_email_unique").on(table.ownerId, table.primaryEmail),
    index("people_owner_category_status_idx").on(
      table.ownerId,
      table.category,
      table.status,
    ),
  ],
);

export const wikiDocuments = pgTable(
  "wiki_documents",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    status: text("status").notNull().default("active"),
    currentRevision: integer("current_revision").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    unique("wiki_documents_owner_kind_slug_unique").on(
      table.ownerId,
      table.kind,
      table.slug,
    ),
    index("wiki_documents_owner_kind_status_idx").on(
      table.ownerId,
      table.kind,
      table.status,
    ),
  ],
);

export const knowledgeRevisions = pgTable(
  "knowledge_revisions",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    revision: integer("revision").notNull(),
    baseRevision: integer("base_revision").notNull(),
    authorType: text("author_type").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    changeReason: text("change_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("knowledge_revisions_resource_revision_unique").on(
      table.resourceType,
      table.resourceId,
      table.revision,
    ),
    index("knowledge_revisions_owner_resource_idx").on(
      table.ownerId,
      table.resourceType,
      table.resourceId,
      table.revision,
    ),
  ],
);

export const knowledgeCitations = pgTable(
  "knowledge_citations",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => knowledgeRevisions.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    sourceRef: text("source_ref").notNull(),
    sourceLabel: text("source_label"),
    accountId: uuid("account_id").references(() => connectedAccounts.id, {
      onDelete: "set null",
    }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("knowledge_citations_owner_revision_idx").on(
      table.ownerId,
      table.revisionId,
    ),
  ],
);

export const knowledgeResourceTombstones = pgTable(
  "knowledge_resource_tombstones",
  {
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("knowledge_resource_tombstones_resource_unique").on(
      table.resourceType,
      table.resourceId,
    ),
    index("knowledge_resource_tombstones_owner_resource_idx").on(
      table.ownerId,
      table.resourceType,
      table.resourceId,
    ),
  ],
);

export const knowledgeConflicts = pgTable(
  "knowledge_conflicts",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    baseRevision: integer("base_revision").notNull(),
    currentRevision: integer("current_revision").notNull(),
    proposedAuthorType: text("proposed_author_type").notNull(),
    proposedSnapshot: jsonb("proposed_snapshot").notNull(),
    proposedCitations: jsonb("proposed_citations").notNull().default([]),
    status: text("status").notNull().default("pending"),
    resolutionRevision: integer("resolution_revision"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("knowledge_conflicts_owner_status_idx").on(
      table.ownerId,
      table.status,
      table.createdAt,
      table.id,
    ),
  ],
);

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    activeVersionId: uuid("active_version_id"),
    revision: integer("revision").notNull().default(1),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    unique("agents_owner_id_id_unique").on(table.ownerId, table.id),
    uniqueIndex("agents_one_personal_per_owner_idx")
      .on(table.ownerId)
      .where(sql`${table.kind} = 'personal'`),
    index("agents_owner_status_idx").on(
      table.ownerId,
      table.status,
      table.createdAt,
      table.id,
    ),
    check("agents_kind_allowed", sql`${table.kind} in ('personal', 'routine')`),
    check(
      "agents_status_allowed",
      sql`${table.status} in ('active', 'disabled')`,
    ),
    check("agents_revision_positive", sql`${table.revision} > 0`),
  ],
);

export const agentVersions = pgTable(
  "agent_versions",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull(),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    changeReason: text("change_reason"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId, table.agentId],
      foreignColumns: [agents.ownerId, agents.id],
      name: "agent_versions_owner_agent_fk",
    }).onDelete("cascade"),
    unique("agent_versions_owner_id_id_unique").on(table.ownerId, table.id),
    unique("agent_versions_owner_agent_id_id_unique").on(
      table.ownerId,
      table.agentId,
      table.id,
    ),
    unique("agent_versions_owner_agent_version_unique").on(
      table.ownerId,
      table.agentId,
      table.version,
    ),
    index("agent_versions_owner_agent_version_idx").on(
      table.ownerId,
      table.agentId,
      table.version,
      table.id,
    ),
    check("agent_versions_version_positive", sql`${table.version} > 0`),
    check(
      "agent_versions_snapshot_object",
      sql`jsonb_typeof(${table.snapshot}) = 'object'`,
    ),
    check(
      "agent_versions_created_by_allowed",
      sql`${table.createdBy} in ('user', 'system')`,
    ),
  ],
);

export const threads = pgTable(
  "threads",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    approvalMode: text("approval_mode").notNull(),
    status: text("status").notNull().default("active"),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    revision: integer("revision").notNull().default(1),
    lastTurnSequence: integer("last_turn_sequence").notNull().default(0),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId, table.agentId],
      foreignColumns: [agents.ownerId, agents.id],
      name: "threads_owner_agent_fk",
    }),
    unique("threads_owner_id_id_unique").on(table.ownerId, table.id),
    index("threads_owner_status_activity_idx").on(
      table.ownerId,
      table.status,
      table.pinnedAt,
      table.updatedAt,
      table.id,
    ),
    check("threads_kind_allowed", sql`${table.kind} in ('assistant', 'task')`),
    check(
      "threads_approval_mode_allowed",
      sql`${table.approvalMode} in ('respect_tool_setting', 'require_approval', 'autonomous')`,
    ),
    check(
      "threads_status_allowed",
      sql`${table.status} in ('active', 'archived', 'deleted')`,
    ),
    check(
      "threads_last_turn_sequence_nonnegative",
      sql`${table.lastTurnSequence} >= 0`,
    ),
  ],
);

export const threadTurns = pgTable(
  "thread_turns",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").notNull(),
    sequence: integer("sequence").notNull(),
    role: text("role").notNull(),
    text: text("text").notNull(),
    sourceType: text("source_type").notNull(),
    sourceRef: text("source_ref"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId, table.threadId],
      foreignColumns: [threads.ownerId, threads.id],
      name: "thread_turns_owner_thread_fk",
    }).onDelete("cascade"),
    unique("thread_turns_owner_id_id_unique").on(table.ownerId, table.id),
    unique("thread_turns_owner_thread_id_unique").on(
      table.ownerId,
      table.threadId,
      table.id,
    ),
    unique("thread_turns_owner_thread_sequence_unique").on(
      table.ownerId,
      table.threadId,
      table.sequence,
    ),
    index("thread_turns_owner_thread_sequence_idx").on(
      table.ownerId,
      table.threadId,
      table.sequence,
      table.id,
    ),
  ],
);

export const threadMentions = pgTable(
  "thread_mentions",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    turnId: uuid("turn_id").notNull(),
    position: integer("position").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    label: text("label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId, table.turnId],
      foreignColumns: [threadTurns.ownerId, threadTurns.id],
      name: "thread_mentions_owner_turn_fk",
    }).onDelete("cascade"),
    unique("thread_mentions_owner_turn_position_unique").on(
      table.ownerId,
      table.turnId,
      table.position,
    ),
    index("thread_mentions_owner_turn_idx").on(
      table.ownerId,
      table.turnId,
      table.position,
      table.id,
    ),
  ],
);

export const threadReadStates = pgTable(
  "thread_read_states",
  {
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").notNull(),
    readThroughSequence: integer("read_through_sequence").notNull().default(0),
    forceUnread: boolean("force_unread").notNull().default(false),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId, table.threadId],
      foreignColumns: [threads.ownerId, threads.id],
      name: "thread_read_states_owner_thread_fk",
    }).onDelete("cascade"),
    primaryKey({
      columns: [table.ownerId, table.threadId],
      name: "thread_read_states_owner_thread_unique",
    }),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("open"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    revision: integer("revision").notNull().default(1),
    ...timestamps,
    completedAt: timestamp("completed_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId, table.threadId],
      foreignColumns: [threads.ownerId, threads.id],
      name: "tasks_owner_thread_fk",
    }),
    unique("tasks_owner_id_id_unique").on(table.ownerId, table.id),
    unique("tasks_owner_thread_unique").on(table.ownerId, table.threadId),
    index("tasks_owner_status_schedule_idx").on(
      table.ownerId,
      table.status,
      table.scheduledFor,
      table.updatedAt,
      table.id,
    ),
  ],
);

export const taskSourceRefs = pgTable(
  "task_source_refs",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull(),
    sourceType: text("source_type").notNull(),
    sourceRef: text("source_ref").notNull(),
    accountId: uuid("account_id"),
    sourceLabel: text("source_label"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId, table.taskId],
      foreignColumns: [tasks.ownerId, tasks.id],
      name: "task_source_refs_owner_task_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ownerId, table.accountId],
      foreignColumns: [connectedAccounts.ownerId, connectedAccounts.id],
      name: "task_source_refs_owner_account_fk",
    }).onDelete("set null"),
    index("task_source_refs_owner_task_idx").on(
      table.ownerId,
      table.taskId,
      table.createdAt,
      table.id,
    ),
  ],
);

export const taskInputRequests = pgTable(
  "task_input_requests",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull(),
    prompt: text("prompt").notNull(),
    status: text("status").notNull().default("pending"),
    response: text("response"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId, table.taskId],
      foreignColumns: [tasks.ownerId, tasks.id],
      name: "task_input_requests_owner_task_fk",
    }).onDelete("cascade"),
    index("task_input_requests_owner_task_status_idx").on(
      table.ownerId,
      table.taskId,
      table.status,
      table.requestedAt,
      table.id,
    ),
  ],
);

export const runtimeSessions = pgTable(
  "runtime_sessions",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    agentVersionId: uuid("agent_version_id").notNull(),
    state: text("state").notNull().default("idle"),
    revision: integer("revision").notNull().default(1),
    lastEventSequence: integer("last_event_sequence").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId, table.threadId],
      foreignColumns: [threads.ownerId, threads.id],
      name: "runtime_sessions_owner_thread_fk",
    }),
    foreignKey({
      columns: [table.ownerId, table.agentId],
      foreignColumns: [agents.ownerId, agents.id],
      name: "runtime_sessions_owner_agent_fk",
    }),
    foreignKey({
      columns: [table.ownerId, table.agentId, table.agentVersionId],
      foreignColumns: [
        agentVersions.ownerId,
        agentVersions.agentId,
        agentVersions.id,
      ],
      name: "runtime_sessions_owner_agent_version_fk",
    }),
    unique("runtime_sessions_owner_id_id_unique").on(table.ownerId, table.id),
    unique("runtime_sessions_owner_thread_unique").on(
      table.ownerId,
      table.threadId,
    ),
    unique("runtime_sessions_owner_thread_id_unique").on(
      table.ownerId,
      table.threadId,
      table.id,
    ),
    index("runtime_sessions_owner_state_activity_idx").on(
      table.ownerId,
      table.state,
      table.updatedAt,
      table.id,
    ),
    check(
      "runtime_sessions_state_allowed",
      sql`${table.state} in ('idle', 'running', 'waiting_approval', 'waiting_user_input', 'failed', 'cancelled')`,
    ),
    check("runtime_sessions_revision_positive", sql`${table.revision} > 0`),
    check(
      "runtime_sessions_event_sequence_nonnegative",
      sql`${table.lastEventSequence} >= 0`,
    ),
  ],
);

export const sessionRuns = pgTable(
  "session_runs",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull(),
    threadId: uuid("thread_id").notNull(),
    triggeringTurnId: uuid("triggering_turn_id").notNull(),
    idempotencyHash: bytea("idempotency_hash").notNull(),
    requestFingerprint: bytea("request_fingerprint").notNull(),
    state: text("state").notNull().default("queued"),
    attempt: integer("attempt").notNull().default(0),
    waitReason: text("wait_reason"),
    outcome: jsonb("outcome"),
    errorCode: text("error_code"),
    ...timestamps,
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId, table.threadId, table.sessionId],
      foreignColumns: [
        runtimeSessions.ownerId,
        runtimeSessions.threadId,
        runtimeSessions.id,
      ],
      name: "session_runs_owner_session_thread_fk",
    }),
    foreignKey({
      columns: [table.ownerId, table.threadId, table.triggeringTurnId],
      foreignColumns: [
        threadTurns.ownerId,
        threadTurns.threadId,
        threadTurns.id,
      ],
      name: "session_runs_owner_triggering_turn_fk",
    }),
    unique("session_runs_owner_id_id_unique").on(table.ownerId, table.id),
    unique("session_runs_owner_session_id_id_unique").on(
      table.ownerId,
      table.sessionId,
      table.id,
    ),
    unique("session_runs_owner_session_turn_unique").on(
      table.ownerId,
      table.sessionId,
      table.triggeringTurnId,
    ),
    unique("session_runs_owner_session_idempotency_unique").on(
      table.ownerId,
      table.sessionId,
      table.idempotencyHash,
    ),
    index("session_runs_owner_session_created_idx").on(
      table.ownerId,
      table.sessionId,
      table.createdAt,
      table.id,
    ),
    check(
      "session_runs_idempotency_hash_size",
      sql`octet_length(${table.idempotencyHash}) = 32`,
    ),
    check(
      "session_runs_request_fingerprint_size",
      sql`octet_length(${table.requestFingerprint}) = 32`,
    ),
    check("session_runs_attempt_nonnegative", sql`${table.attempt} >= 0`),
  ],
);

export const sessionEvents = pgTable(
  "session_events",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull(),
    runId: uuid("run_id").notNull(),
    sequence: integer("sequence").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId, table.sessionId],
      foreignColumns: [runtimeSessions.ownerId, runtimeSessions.id],
      name: "session_events_owner_session_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ownerId, table.sessionId, table.runId],
      foreignColumns: [
        sessionRuns.ownerId,
        sessionRuns.sessionId,
        sessionRuns.id,
      ],
      name: "session_events_owner_session_run_fk",
    }).onDelete("cascade"),
    unique("session_events_owner_id_id_unique").on(table.ownerId, table.id),
    unique("session_events_owner_session_sequence_unique").on(
      table.ownerId,
      table.sessionId,
      table.sequence,
    ),
    index("session_events_owner_session_sequence_idx").on(
      table.ownerId,
      table.sessionId,
      table.sequence,
      table.id,
    ),
    check("session_events_sequence_positive", sql`${table.sequence} > 0`),
    check(
      "session_events_payload_object",
      sql`jsonb_typeof(${table.payload}) = 'object'`,
    ),
  ],
);

export const runtimeJobs = pgTable(
  "runtime_jobs",
  {
    runId: uuid("run_id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull(),
    state: text("state").notNull().default("queued"),
    attempt: integer("attempt").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseTokenHash: bytea("lease_token_hash"),
    leasedBy: text("leased_by"),
    leasedAt: timestamp("leased_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId, table.sessionId, table.runId],
      foreignColumns: [
        sessionRuns.ownerId,
        sessionRuns.sessionId,
        sessionRuns.id,
      ],
      name: "runtime_jobs_owner_session_run_fk",
    }).onDelete("cascade"),
    unique("runtime_jobs_owner_run_unique").on(table.ownerId, table.runId),
    index("runtime_jobs_claim_idx").on(
      table.state,
      table.availableAt,
      table.createdAt,
      table.runId,
    ),
    check("runtime_jobs_attempt_nonnegative", sql`${table.attempt} >= 0`),
    check(
      "runtime_jobs_lease_token_hash_size",
      sql`${table.leaseTokenHash} is null or octet_length(${table.leaseTokenHash}) = 32`,
    ),
  ],
);

export const toolDefinitions = pgTable(
  "tool_definitions",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    version: integer("version").notNull().default(1),
    description: text("description").notNull(),
    inputSchema: jsonb("input_schema").notNull(),
    outputSchema: jsonb("output_schema"),
    sideEffect: text("side_effect").notNull(),
    dataSensitivity: text("data_sensitivity").notNull(),
    accountBinding: text("account_binding").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("tool_definitions_owner_id_id_unique").on(table.ownerId, table.id),
    unique("tool_definitions_owner_name_version_unique").on(
      table.ownerId,
      table.name,
      table.version,
    ),
    index("tool_definitions_owner_name_idx").on(
      table.ownerId,
      table.name,
      table.version,
      table.id,
    ),
    check(
      "tool_definitions_input_schema_object",
      sql`jsonb_typeof(${table.inputSchema}) = 'object'`,
    ),
    check(
      "tool_definitions_side_effect_allowed",
      sql`${table.sideEffect} in ('read', 'private_write', 'external_write', 'destructive')`,
    ),
  ],
);

export const agentToolBindings = pgTable(
  "agent_tool_bindings",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentVersionId: uuid("agent_version_id").notNull(),
    toolDefinitionId: uuid("tool_definition_id").notNull(),
    modeOverride: text("mode_override"),
    accountScope: jsonb("account_scope").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId, table.agentVersionId],
      foreignColumns: [agentVersions.ownerId, agentVersions.id],
      name: "agent_tool_bindings_owner_agent_version_fk",
    }),
    foreignKey({
      columns: [table.ownerId, table.toolDefinitionId],
      foreignColumns: [toolDefinitions.ownerId, toolDefinitions.id],
      name: "agent_tool_bindings_owner_tool_definition_fk",
    }),
    unique("agent_tool_bindings_owner_id_id_unique").on(
      table.ownerId,
      table.id,
    ),
    unique("agent_tool_bindings_owner_version_tool_unique").on(
      table.ownerId,
      table.agentVersionId,
      table.toolDefinitionId,
    ),
    index("agent_tool_bindings_owner_version_idx").on(
      table.ownerId,
      table.agentVersionId,
      table.createdAt,
      table.id,
    ),
  ],
);

export const policyDecisions = pgTable(
  "policy_decisions",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull(),
    runId: uuid("run_id").notNull(),
    toolCallId: uuid("tool_call_id"),
    decision: text("decision").notNull(),
    sessionMode: text("session_mode").notNull(),
    routineMode: text("routine_mode").notNull(),
    perToolOverride: text("per_tool_override"),
    sideEffect: text("side_effect").notNull(),
    dataSensitivity: text("data_sensitivity").notNull(),
    inputTrust: text("input_trust").notNull(),
    targetIsSelf: boolean("target_is_self").notNull(),
    targetIsTrusted: boolean("target_is_trusted").notNull(),
    accountId: uuid("account_id"),
    riskFlags: jsonb("risk_flags").notNull().default([]),
    rationale: text("rationale").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId, table.sessionId],
      foreignColumns: [runtimeSessions.ownerId, runtimeSessions.id],
      name: "policy_decisions_owner_session_fk",
    }),
    foreignKey({
      columns: [table.ownerId, table.sessionId, table.runId],
      foreignColumns: [
        sessionRuns.ownerId,
        sessionRuns.sessionId,
        sessionRuns.id,
      ],
      name: "policy_decisions_owner_session_run_fk",
    }),
    foreignKey({
      columns: [table.ownerId, table.accountId],
      foreignColumns: [connectedAccounts.ownerId, connectedAccounts.id],
      name: "policy_decisions_owner_account_fk",
    }),
    unique("policy_decisions_owner_id_id_unique").on(table.ownerId, table.id),
    index("policy_decisions_owner_run_idx").on(
      table.ownerId,
      table.sessionId,
      table.runId,
      table.createdAt,
      table.id,
    ),
    check(
      "policy_decisions_risk_flags_array",
      sql`jsonb_typeof(${table.riskFlags}) = 'array'`,
    ),
  ],
);

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull(),
    runId: uuid("run_id").notNull(),
    agentVersionId: uuid("agent_version_id").notNull(),
    toolDefinitionId: uuid("tool_definition_id").notNull(),
    policyDecisionId: uuid("policy_decision_id").notNull(),
    stepKey: text("step_key").notNull(),
    idempotencyKeyHash: bytea("idempotency_key_hash").notNull(),
    argumentHash: bytea("argument_hash").notNull(),
    requestFingerprint: bytea("request_fingerprint").notNull(),
    arguments: jsonb("arguments").notNull(),
    status: text("status").notNull().default("proposed"),
    approvalRequestId: uuid("approval_request_id"),
    result: jsonb("result"),
    errorCode: text("error_code"),
    ...timestamps,
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId, table.sessionId],
      foreignColumns: [runtimeSessions.ownerId, runtimeSessions.id],
      name: "tool_calls_owner_session_fk",
    }),
    foreignKey({
      columns: [table.ownerId, table.sessionId, table.runId],
      foreignColumns: [
        sessionRuns.ownerId,
        sessionRuns.sessionId,
        sessionRuns.id,
      ],
      name: "tool_calls_owner_session_run_fk",
    }),
    foreignKey({
      columns: [table.ownerId, table.agentVersionId],
      foreignColumns: [agentVersions.ownerId, agentVersions.id],
      name: "tool_calls_owner_agent_version_fk",
    }),
    foreignKey({
      columns: [table.ownerId, table.toolDefinitionId],
      foreignColumns: [toolDefinitions.ownerId, toolDefinitions.id],
      name: "tool_calls_owner_tool_definition_fk",
    }),
    foreignKey({
      columns: [table.ownerId, table.policyDecisionId],
      foreignColumns: [policyDecisions.ownerId, policyDecisions.id],
      name: "tool_calls_owner_policy_decision_fk",
    }),
    unique("tool_calls_owner_id_id_unique").on(table.ownerId, table.id),
    unique("tool_calls_owner_step_idempotency_unique").on(
      table.ownerId,
      table.runId,
      table.stepKey,
      table.idempotencyKeyHash,
    ),
    index("tool_calls_owner_run_idx").on(
      table.ownerId,
      table.sessionId,
      table.runId,
      table.createdAt,
      table.id,
    ),
    check(
      "tool_calls_argument_hash_size",
      sql`octet_length(${table.argumentHash}) = 32`,
    ),
    check(
      "tool_calls_request_fingerprint_size",
      sql`octet_length(${table.requestFingerprint}) = 32`,
    ),
    check(
      "tool_calls_arguments_object",
      sql`jsonb_typeof(${table.arguments}) = 'object'`,
    ),
  ],
);

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull(),
    runId: uuid("run_id").notNull(),
    toolCallId: uuid("tool_call_id").notNull(),
    argumentHash: bytea("argument_hash").notNull(),
    arguments: jsonb("arguments").notNull(),
    state: text("state").notNull().default("pending"),
    revision: integer("revision").notNull().default(1),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: uuid("decided_by"),
    decisionNote: text("decision_note"),
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId, table.sessionId],
      foreignColumns: [runtimeSessions.ownerId, runtimeSessions.id],
      name: "approval_requests_owner_session_fk",
    }),
    foreignKey({
      columns: [table.ownerId, table.sessionId, table.runId],
      foreignColumns: [
        sessionRuns.ownerId,
        sessionRuns.sessionId,
        sessionRuns.id,
      ],
      name: "approval_requests_owner_session_run_fk",
    }),
    foreignKey({
      columns: [table.ownerId, table.toolCallId],
      foreignColumns: [toolCalls.ownerId, toolCalls.id],
      name: "approval_requests_owner_tool_call_fk",
    }),
    foreignKey({
      columns: [table.decidedBy],
      foreignColumns: [users.id],
      name: "approval_requests_owner_decided_by_fk",
    }),
    unique("approval_requests_owner_id_id_unique").on(table.ownerId, table.id),
    unique("approval_requests_tool_call_unique").on(
      table.ownerId,
      table.toolCallId,
    ),
    index("approval_requests_owner_status_idx").on(
      table.ownerId,
      table.state,
      table.requestedAt,
      table.id,
    ),
    check(
      "approval_requests_frozen_arguments_object",
      sql`jsonb_typeof(${table.arguments}) = 'object'`,
    ),
  ],
);

export const routineSchedules = pgTable(
  "routine_schedules",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull(),
    agentVersionId: uuid("agent_version_id").notNull(),
    name: text("name").notNull(),
    cron: text("cron").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    enabled: boolean("enabled").notNull().default(true),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    revision: integer("revision").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId, table.agentId],
      foreignColumns: [agents.ownerId, agents.id],
      name: "routine_schedules_owner_agent_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ownerId, table.agentId, table.agentVersionId],
      foreignColumns: [
        agentVersions.ownerId,
        agentVersions.agentId,
        agentVersions.id,
      ],
      name: "routine_schedules_owner_version_fk",
    }).onDelete("restrict"),
    uniqueIndex("routine_schedules_owner_name_unique").on(
      table.ownerId,
      sql`lower(${table.name})`,
    ),
    unique("routine_schedules_owner_id_unique").on(table.ownerId, table.id),
    index("routine_schedules_due_idx").on(
      table.ownerId,
      table.enabled,
      table.nextRunAt,
      table.id,
    ),
    check("routine_schedules_revision_positive", sql`${table.revision} > 0`),
  ],
);

export const integrationSyncRuns = pgTable(
  "integration_sync_runs",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull(),
    routineScheduleId: uuid("routine_schedule_id"),
    provider: text("provider").notNull(),
    status: text("status").notNull().default("queued"),
    cursor: jsonb("cursor").notNull().default({}),
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId, table.accountId],
      foreignColumns: [connectedAccounts.ownerId, connectedAccounts.id],
      name: "integration_sync_runs_owner_account_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ownerId, table.routineScheduleId],
      foreignColumns: [routineSchedules.ownerId, routineSchedules.id],
      name: "integration_sync_runs_owner_routine_fk",
    }).onDelete("set null"),
    index("integration_sync_runs_owner_status_idx").on(
      table.ownerId,
      table.status,
      table.createdAt,
      table.id,
    ),
    unique("integration_sync_runs_owner_id_unique").on(table.ownerId, table.id),
    check(
      "integration_sync_runs_cursor_object",
      sql`jsonb_typeof(${table.cursor}) = 'object'`,
    ),
    check(
      "integration_sync_runs_status_allowed",
      sql`${table.status} in ('queued','running','succeeded','failed','blocked')`,
    ),
  ],
);

export const routineStepResults = pgTable(
  "routine_step_results",
  {
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull(),
    stepKey: text("step_key").notNull(),
    status: text("status").notNull(),
    output: jsonb("output"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.runId, table.stepKey] }),
    index("routine_step_results_owner_run_idx").on(
      table.ownerId,
      table.runId,
      table.createdAt,
      table.stepKey,
    ),
    check(
      "routine_step_results_status_allowed",
      sql`${table.status} in ('running', 'completed', 'failed')`,
    ),
    check(
      "routine_step_results_step_key_shape",
      sql`length(btrim(${table.stepKey})) between 1 and 200`,
    ),
    check(
      "routine_step_results_state_shape",
      sql`(${table.status} = 'running' and ${table.output} is null and ${table.errorCode} is null and ${table.errorMessage} is null and ${table.startedAt} is not null and ${table.finishedAt} is null) or (${table.status} = 'completed' and ${table.output} is not null and ${table.errorCode} is null and ${table.errorMessage} is null and ${table.startedAt} is not null and ${table.finishedAt} is not null) or (${table.status} = 'failed' and ${table.output} is null and ${table.errorCode} is not null and length(btrim(${table.errorCode})) > 0 and ${table.errorMessage} is not null and length(btrim(${table.errorMessage})) > 0 and ${table.startedAt} is not null and ${table.finishedAt} is not null)`,
    ),
    foreignKey({
      columns: [table.ownerId, table.runId],
      foreignColumns: [integrationSyncRuns.ownerId, integrationSyncRuns.id],
      name: "routine_step_results_owner_run_fk",
    }).onDelete("cascade"),
  ],
);

export const harnessThreads = pgTable(
  "harness_threads",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    snapshot: jsonb("snapshot").notNull(),
    revision: integer("revision").notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check(
      "harness_threads_snapshot_object",
      sql`jsonb_typeof(${table.snapshot}) = 'object'`,
    ),
    check("harness_threads_revision_nonnegative", sql`${table.revision} >= 0`),
    check(
      "harness_threads_lease_shape",
      sql`(${table.leaseOwner} is null and ${table.leaseExpiresAt} is null) or (${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null)`,
    ),
    index("harness_threads_owner_idx").on(
      table.ownerId,
      table.updatedAt,
      table.id,
    ),
  ],
);

export const contentItems = pgTable(
  "content_items",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    mimeType: text("mime_type"),
    storageKey: text("storage_key"),
    body: text("body"),
    metadata: jsonb("metadata").notNull().default({}),
    sourceSessionId: uuid("source_session_id"),
    status: text("status").notNull().default("active"),
    currentRevision: integer("current_revision").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    unique("content_items_owner_id_id_unique").on(table.ownerId, table.id),
    uniqueIndex("content_items_owner_storage_key_unique").on(
      table.ownerId,
      table.storageKey,
    ),
    index("content_items_owner_status_idx").on(
      table.ownerId,
      table.status,
      table.updatedAt,
      table.id,
    ),
    check(
      "content_items_kind_allowed",
      sql`${table.kind} in ('document','file','image','audio','recording','briefing')`,
    ),
    check(
      "content_items_status_allowed",
      sql`${table.status} in ('active','archived','deleted')`,
    ),
    check(
      "content_items_payload_present",
      sql`${table.storageKey} is not null or ${table.body} is not null`,
    ),
    check(
      "content_items_metadata_object",
      sql`jsonb_typeof(${table.metadata}) = 'object'`,
    ),
    foreignKey({
      columns: [table.ownerId, table.sourceSessionId],
      foreignColumns: [runtimeSessions.ownerId, runtimeSessions.id],
      name: "content_items_owner_source_session_fk",
    }),
  ],
);

export const contentRevisions = pgTable(
  "content_revisions",
  {
    id: uuid("id").primaryKey(),
    contentId: uuid("content_id").notNull(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    title: text("title").notNull(),
    mimeType: text("mime_type"),
    storageKey: text("storage_key"),
    body: text("body"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("content_revisions_content_revision_unique").on(
      table.contentId,
      table.revision,
    ),
    index("content_revisions_owner_content_idx").on(
      table.ownerId,
      table.contentId,
      table.revision,
    ),
    check(
      "content_revisions_payload_present",
      sql`${table.storageKey} is not null or ${table.body} is not null`,
    ),
    check(
      "content_revisions_metadata_object",
      sql`jsonb_typeof(${table.metadata}) = 'object'`,
    ),
    foreignKey({
      columns: [table.ownerId, table.contentId],
      foreignColumns: [contentItems.ownerId, contentItems.id],
      name: "content_revisions_owner_content_fk",
    }).onDelete("cascade"),
  ],
);

export const contentCollections = pgTable(
  "content_collections",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    ...timestamps,
  },
  (table) => [
    unique("content_collections_owner_id_name_unique").on(
      table.ownerId,
      table.name,
    ),
    unique("content_collections_owner_id_unique").on(table.ownerId, table.id),
    index("content_collections_owner_idx").on(
      table.ownerId,
      table.updatedAt,
      table.id,
    ),
  ],
);

export const contentCollectionItems = pgTable(
  "content_collection_items",
  {
    collectionId: uuid("collection_id").notNull(),
    contentId: uuid("content_id").notNull(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.collectionId, table.contentId] }),
    index("content_collection_items_owner_idx").on(
      table.ownerId,
      table.collectionId,
      table.position,
      table.contentId,
    ),
    check(
      "content_collection_items_position_nonnegative",
      sql`${table.position} >= 0`,
    ),
    foreignKey({
      columns: [table.ownerId, table.collectionId],
      foreignColumns: [contentCollections.ownerId, contentCollections.id],
      name: "content_collection_items_owner_collection_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ownerId, table.contentId],
      foreignColumns: [contentItems.ownerId, contentItems.id],
      name: "content_collection_items_owner_content_fk",
    }).onDelete("cascade"),
  ],
);

export const contentShareTokens = pgTable(
  "content_share_tokens",
  {
    id: uuid("id").primaryKey(),
    contentId: uuid("content_id").notNull(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: bytea("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("content_share_tokens_lookup_idx").on(table.tokenHash),
    foreignKey({
      columns: [table.ownerId, table.contentId],
      foreignColumns: [contentItems.ownerId, contentItems.id],
      name: "content_share_tokens_owner_content_fk",
    }).onDelete("cascade"),
  ],
);

export const squares = pgTable(
  "squares",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("active"),
    settings: jsonb("settings").notNull().default({}),
    ...timestamps,
  },
  (table) => [
    unique("squares_owner_id_id_unique").on(table.ownerId, table.id),
    unique("squares_owner_slug_unique").on(table.ownerId, table.slug),
    index("squares_owner_status_idx").on(
      table.ownerId,
      table.status,
      table.updatedAt,
      table.id,
    ),
    check(
      "squares_status_allowed",
      sql`${table.status} in ('active','archived')`,
    ),
    check(
      "squares_settings_object",
      sql`jsonb_typeof(${table.settings}) = 'object'`,
    ),
  ],
);
export const squareMemberships = pgTable(
  "square_memberships",
  {
    squareId: uuid("square_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    status: text("status").notNull().default("active"),
    invitedBy: uuid("invited_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.squareId, table.userId] }),
    index("square_memberships_user_status_idx").on(
      table.userId,
      table.status,
      table.squareId,
    ),
    index("square_memberships_square_role_idx").on(
      table.squareId,
      table.status,
      table.role,
      table.userId,
    ),
    check(
      "square_memberships_role_allowed",
      sql`${table.role} in ('owner','admin','member')`,
    ),
    check(
      "square_memberships_status_allowed",
      sql`${table.status} in ('invited','active','suspended')`,
    ),
    check(
      "square_memberships_owner_invariant",
      sql`(${table.userId} = ${table.ownerId} and ${table.role} = 'owner' and ${table.status} = 'active') or (${table.userId} <> ${table.ownerId} and ${table.role} <> 'owner')`,
    ),
    foreignKey({
      columns: [table.ownerId, table.squareId],
      foreignColumns: [squares.ownerId, squares.id],
      name: "square_memberships_owner_square_fk",
    }).onDelete("cascade"),
  ],
);
export const squarePolicies = pgTable(
  "square_policies",
  {
    squareId: uuid("square_id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    defaultMode: text("default_mode").notNull().default("approval_required"),
    allowedDomains: jsonb("allowed_domains").notNull().default([]),
    allowedToolNames: jsonb("allowed_tool_names").notNull().default([]),
    settings: jsonb("settings").notNull().default({}),
    revision: integer("revision").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    check(
      "square_policies_mode_allowed",
      sql`${table.defaultMode} in ('read_only','approval_required','autonomous')`,
    ),
    check(
      "square_policies_domains_array",
      sql`jsonb_typeof(${table.allowedDomains}) = 'array'`,
    ),
    check(
      "square_policies_tools_array",
      sql`jsonb_typeof(${table.allowedToolNames}) = 'array'`,
    ),
    check(
      "square_policies_settings_object",
      sql`jsonb_typeof(${table.settings}) = 'object'`,
    ),
    check("square_policies_revision_positive", sql`${table.revision} > 0`),
    foreignKey({
      columns: [table.ownerId, table.squareId],
      foreignColumns: [squares.ownerId, squares.id],
      name: "square_policies_owner_square_fk",
    }).onDelete("cascade"),
  ],
);

export const squareAccountShares = pgTable(
  "square_account_shares",
  {
    id: uuid("id").primaryKey(),
    squareId: uuid("square_id").notNull(),
    squareOwnerId: uuid("square_owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull(),
    accountOwnerId: uuid("account_owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    grantedBy: uuid("granted_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    capabilities: jsonb("capabilities").notNull().default([]),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    unique("square_account_shares_unique").on(
      table.squareId,
      table.accountOwnerId,
      table.accountId,
    ),
    index("square_account_shares_square_status_idx").on(
      table.squareOwnerId,
      table.squareId,
      table.status,
      table.createdAt,
      table.id,
    ),
    index("square_account_shares_account_idx").on(
      table.accountOwnerId,
      table.accountId,
      table.status,
    ),
    check(
      "square_account_shares_capabilities_array",
      sql`jsonb_typeof(${table.capabilities}) = 'array'`,
    ),
    check(
      "square_account_shares_status_allowed",
      sql`${table.status} in ('active','revoked')`,
    ),
    check(
      "square_account_shares_revoked_shape",
      sql`(${table.status} = 'active' and ${table.revokedAt} is null) or (${table.status} = 'revoked' and ${table.revokedAt} is not null)`,
    ),
    foreignKey({
      columns: [table.squareOwnerId, table.squareId],
      foreignColumns: [squares.ownerId, squares.id],
      name: "square_account_shares_owner_square_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.accountOwnerId, table.accountId],
      foreignColumns: [connectedAccounts.ownerId, connectedAccounts.id],
      name: "square_account_shares_owner_account_fk",
    }).onDelete("cascade"),
  ],
);

export const notificationChannels = pgTable(
  "notification_channels",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    address: text("address").notNull(),
    config: jsonb("config").notNull().default({}),
    status: text("status").notNull().default("active"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("notification_channels_owner_id_unique").on(table.ownerId, table.id),
    index("notification_channels_owner_status_idx").on(
      table.ownerId,
      table.status,
      table.createdAt,
      table.id,
    ),
    check(
      "notification_channels_kind_allowed",
      sql`${table.kind} in ('email','webhook','telegram','whatsapp')`,
    ),
    check(
      "notification_channels_status_allowed",
      sql`${table.status} in ('active','disabled')`,
    ),
    check(
      "notification_channels_config_object",
      sql`jsonb_typeof(${table.config}) = 'object'`,
    ),
    check(
      "notification_channels_address_nonempty",
      sql`length(btrim(${table.address})) > 0`,
    ),
  ],
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").notNull(),
    eventType: text("event_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").notNull(),
    fingerprint: text("fingerprint").notNull(),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    claimedBy: text("claimed_by"),
    claimToken: text("claim_token"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId, table.channelId],
      foreignColumns: [notificationChannels.ownerId, notificationChannels.id],
      name: "notification_deliveries_owner_channel_fk",
    }).onDelete("cascade"),
    unique("notification_deliveries_owner_key_unique").on(
      table.ownerId,
      table.idempotencyKey,
    ),
    index("notification_deliveries_claim_idx").on(
      table.status,
      table.nextAttemptAt,
      table.createdAt,
      table.id,
    ),
    index("notification_deliveries_owner_idx").on(
      table.ownerId,
      table.createdAt,
      table.id,
    ),
    check(
      "notification_deliveries_status_allowed",
      sql`${table.status} in ('queued','attempting','succeeded','failed')`,
    ),
    check(
      "notification_deliveries_attempts_nonnegative",
      sql`${table.attempts} >= 0`,
    ),
    check(
      "notification_deliveries_payload_object",
      sql`jsonb_typeof(${table.payload}) = 'object'`,
    ),
  ],
);
