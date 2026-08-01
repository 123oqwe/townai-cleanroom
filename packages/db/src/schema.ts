import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
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
