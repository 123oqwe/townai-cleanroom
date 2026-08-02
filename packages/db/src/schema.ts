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
