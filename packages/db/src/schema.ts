import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
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
