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

describe("agent, thread, and task migration", () => {
  it("creates the complete owner-constrained schema", async () => {
    await runMigrations(sql);

    const tables = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public'
    `;
    const constraints = await sql<{ constraint_name: string }[]>`
      select constraint_name from information_schema.table_constraints
      where table_schema = 'public'
    `;
    const indexes = await sql<{ indexname: string }[]>`
      select indexname from pg_indexes where schemaname = 'public'
    `;
    const triggers = await sql<{ trigger_name: string }[]>`
      select trigger_name from information_schema.triggers
      where trigger_schema = 'public'
    `;

    expect(tables.map(({ table_name }) => table_name)).toEqual(
      expect.arrayContaining([
        "agent_versions",
        "agents",
        "task_input_requests",
        "task_source_refs",
        "tasks",
        "thread_mentions",
        "thread_read_states",
        "thread_turns",
        "threads",
      ]),
    );
    expect(constraints.map(({ constraint_name }) => constraint_name)).toEqual(
      expect.arrayContaining([
        "agent_versions_owner_agent_fk",
        "agent_versions_owner_agent_version_unique",
        "agents_owner_active_version_fk",
        "agents_owner_id_id_unique",
        "task_input_requests_state_valid",
        "task_source_refs_owner_account_fk",
        "tasks_lifecycle_valid",
        "tasks_owner_thread_unique",
        "thread_mentions_owner_turn_position_unique",
        "thread_read_states_owner_thread_unique",
        "thread_turns_owner_thread_sequence_unique",
        "threads_deletion_state_valid",
        "threads_last_turn_sequence_nonnegative",
      ]),
    );
    expect(indexes.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining([
        "agent_versions_owner_agent_version_idx",
        "agents_one_personal_per_owner_idx",
        "task_input_requests_owner_task_status_idx",
        "task_source_refs_owner_task_idx",
        "tasks_owner_status_schedule_idx",
        "thread_mentions_owner_turn_idx",
        "thread_turns_owner_thread_sequence_idx",
        "threads_owner_status_activity_idx",
      ]),
    );
    expect(triggers.map(({ trigger_name }) => trigger_name)).toEqual(
      expect.arrayContaining([
        "agent_versions_immutable_update",
        "thread_mentions_immutable_update",
        "thread_turns_immutable_update",
      ]),
    );
  });

  it("applies all migrations exactly once", async () => {
    await runMigrations(sql);
    await runMigrations(sql);

    const [row] = await sql<{ names: string[] }[]>`
      select array_agg(name order by name) as names from schema_migrations
    `;

    expect(row?.names).toEqual([
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
    ]);
  });
});
