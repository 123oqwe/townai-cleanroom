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
      "0006_routines_integrations.sql",
      "0007_routine_cron_constraint.sql",
      "0008_harness_threads.sql",
      "0009_harness_thread_owners.sql",
      "0010_routine_step_results.sql",
      "0011_content_library.sql",
      "0012_squares.sql",
      "0013_square_account_shares.sql",
      "0014_channels.sql",
      "0015_billing.sql",
      "0016_operations.sql",
      "0017_routine_schedule_delete_restrict.sql",
      "0018_sync_run_updated_at.sql",
      "0019_routine_webhooks.sql",
      "0020_routine_runtime_link.sql",
      "0021_suggestions.sql",
      "0022_suggestion_task_conversion.sql",
      "0023_oauth_connect_states.sql",
      "0024_a2a_requests.sql",
      "0025_harness_approval_decisions.sql",
      "0026_routine_shares.sql",
      "0027_content_library_kinds.sql",
      "0028_person_relationships.sql",
      "0029_notification_channel_kinds.sql",
      "0030_routine_triggers.sql",
      "0031_mcp_servers.sql",
      "0032_mcp_bindings.sql",
      "0033_routine_results.sql",
      "0034_routine_trigger_data.sql",
      "0035_routine_run_claims.sql",
      "0036_routine_run_replays.sql",
      "0037_routine_trigger_idempotency.sql",
      "0038_extended_routine_trigger_types.sql",
      "0039_a2a_consent.sql",
      "0040_runtime_input_response.sql",
      "0041_notification_delivery_replays.sql",
      "0042_email_to_assistant_runs.sql",
      "0043_analytics_events.sql",
      "0044_presence_sessions.sql",
      "0045_public_analytics_events.sql",
      "0046_goals_projects.sql",
      "0047_trusted_contacts.sql",
      "0048_knowledge_graph.sql",
      "0049_telegram_whatsapp_triggers.sql",
      "0050_rate_limit_buckets.sql",
      "0051_rate_limit_concurrency.sql",
    ]);
  });
});
