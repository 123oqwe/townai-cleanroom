import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import postgres, { type Sql } from "postgres";

import { runMigrations } from "../src/migrate.js";

let sql: Sql;

beforeAll(() => {
  sql = postgres(inject("postgresUrl"), { max: 1 });
});

afterAll(async () => {
  await sql.end();
});

describe("knowledge migration", () => {
  it("creates the complete constrained knowledge schema", async () => {
    await runMigrations(sql);

    const tables = await sql<{ table_name: string }[]>`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
    `;
    const constraints = await sql<{ constraint_name: string }[]>`
      select constraint_name
      from information_schema.table_constraints
      where table_schema = 'public'
    `;
    const indexes = await sql<{ indexname: string }[]>`
      select indexname
      from pg_indexes
      where schemaname = 'public'
    `;

    expect(tables.map(({ table_name }) => table_name)).toEqual(
      expect.arrayContaining([
        "knowledge_citations",
        "knowledge_conflicts",
        "knowledge_revisions",
        "knowledge_resource_tombstones",
        "memories",
        "people",
        "profiles",
        "wiki_documents",
      ]),
    );
    expect(constraints.map(({ constraint_name }) => constraint_name)).toEqual(
      expect.arrayContaining([
        "connected_accounts_owner_id_id_unique",
        "knowledge_citations_owner_account_fk",
        "knowledge_citations_owner_revision_fk",
        "knowledge_conflicts_revision_order",
        "knowledge_revisions_owner_id_id_unique",
        "knowledge_resource_tombstones_resource_unique",
        "knowledge_revisions_resource_revision_unique",
        "memories_freshness_valid",
        "memories_scope_valid",
        "people_category_allowed",
        "profiles_owner_id_unique",
        "wiki_documents_owner_kind_slug_unique",
      ]),
    );
    expect(indexes.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining([
        "knowledge_citations_owner_revision_idx",
        "knowledge_conflicts_owner_status_idx",
        "knowledge_resource_tombstones_owner_resource_idx",
        "memories_owner_scope_status_idx",
        "people_owner_category_status_idx",
        "wiki_documents_owner_kind_status_idx",
      ]),
    );
  });

  it("keeps every known migration recorded exactly once", async () => {
    await runMigrations(sql);
    await runMigrations(sql);

    const rows = await sql<{ names: string[] }[]>`
      select array_agg(name order by name) as names
      from schema_migrations
    `;

    expect(rows[0]?.names).toEqual([
      "0001_identity.sql",
      "0002_knowledge.sql",
      "0003_agents_threads_tasks.sql",
      "0004_persistent_sessions.sql",
      "0005_tools_policy_approvals.sql",
    ]);
  });
});
