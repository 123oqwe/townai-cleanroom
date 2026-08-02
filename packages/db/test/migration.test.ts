import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import postgres, { type Sql } from "postgres";

import { runMigrations } from "../src/migrate.js";

let sql: Sql;

beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 1 });
});

afterAll(async () => {
  await sql.end();
});

describe("identity migration", () => {
  it("creates the complete constrained identity schema", async () => {
    await runMigrations(sql);

    const extensions = await sql<{ extname: string }[]>`
      select extname from pg_extension where extname = 'citext'
    `;
    const tables = await sql<{ table_name: string }[]>`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
      order by table_name
    `;
    const constraints = await sql<{ conname: string }[]>`
      select constraint_name as conname
      from information_schema.table_constraints
      where table_schema = 'public'
    `;

    expect(extensions.map(({ extname }) => extname)).toEqual(["citext"]);
    expect(tables.map(({ table_name }) => table_name)).toEqual(
      expect.arrayContaining([
        "access_allowlist",
        "auth_sessions",
        "connected_accounts",
        "oauth_credentials",
        "schema_migrations",
        "users",
        "harness_threads",
        "routine_step_results",
      ]),
    );
    expect(constraints.map(({ conname }) => conname)).toEqual(
      expect.arrayContaining([
        "auth_sessions_user_id_users_id_fk",
        "connected_accounts_credential_id_oauth_credentials_id_fk",
        "connected_accounts_owner_id_users_id_fk",
        "connected_accounts_owner_provider_identity_unique",
        "oauth_credentials_owner_id_users_id_fk",
        "oauth_credentials_positive_key_version",
        "users_status_allowed",
        "integration_sync_runs_owner_id_unique",
        "routine_step_results_owner_run_fk",
        "notification_deliveries_owner_channel_fk",
      ]),
    );
  }, 60_000);

  it("is idempotent and records the identity migration once", async () => {
    await runMigrations(sql);
    await runMigrations(sql);

    const rows = await sql<{ count: number }[]>`
      select count(*)::int as count
      from schema_migrations
      where name = '0001_identity.sql'
    `;

    expect(rows[0]?.count).toBe(1);
  });
});
