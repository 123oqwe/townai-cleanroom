import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";

import { runMigrations } from "../src/migrate.js";

let container: StartedPostgreSqlContainer;
let sql: Sql;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  sql = postgres(container.getConnectionUri(), { max: 1 });
}, 60_000);

afterAll(async () => {
  await sql.end();
  await container.stop();
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
      ]),
    );
  }, 60_000);

  it("is idempotent and records one applied migration", async () => {
    await runMigrations(sql);
    await runMigrations(sql);

    const rows = await sql<{ count: number }[]>`
      select count(*)::int as count from schema_migrations
    `;

    expect(rows[0]?.count).toBe(1);
  });
});
