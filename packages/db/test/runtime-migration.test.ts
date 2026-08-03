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

describe("persistent runtime and tool-policy migrations", () => {
  it("creates owner-bound sessions, runs, events, and jobs", async () => {
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
        "runtime_jobs",
        "runtime_sessions",
        "session_events",
        "session_runs",
        "tool_definitions",
        "agent_tool_bindings",
        "policy_decisions",
        "tool_calls",
        "approval_requests",
      ]),
    );
    expect(constraints.map(({ constraint_name }) => constraint_name)).toEqual(
      expect.arrayContaining([
        "runtime_jobs_lease_shape_valid",
        "runtime_jobs_owner_session_run_fk",
        "runtime_sessions_event_sequence_nonnegative",
        "runtime_sessions_owner_agent_version_fk",
        "runtime_sessions_owner_thread_unique",
        "session_events_owner_session_sequence_unique",
        "session_events_payload_object",
        "session_runs_idempotency_hash_size",
        "session_runs_lifecycle_valid",
        "session_runs_owner_session_idempotency_unique",
        "session_runs_owner_session_turn_unique",
        "tool_definitions_side_effect_allowed",
        "tool_definitions_input_schema_object",
        "agent_tool_bindings_owner_agent_version_fk",
        "policy_decisions_risk_flags_array",
        "tool_calls_argument_hash_size",
        "tool_calls_request_fingerprint_size",
        "tool_calls_owner_session_agent_version_fk",
        "approval_requests_state_allowed",
        "approval_requests_frozen_arguments_object",
        "approval_requests_decided_by_owner",
      ]),
    );
    expect(indexes.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining([
        "runtime_jobs_claim_idx",
        "runtime_sessions_owner_state_activity_idx",
        "session_events_owner_session_sequence_idx",
        "session_runs_owner_session_created_idx",
        "tool_definitions_owner_name_idx",
        "agent_tool_bindings_owner_version_idx",
        "policy_decisions_owner_run_idx",
        "tool_calls_owner_run_idx",
        "approval_requests_owner_status_idx",
      ]),
    );
    expect(triggers.map(({ trigger_name }) => trigger_name)).toEqual(
      expect.arrayContaining(["session_events_immutable_update"]),
    );
  });

  it("applies every migration exactly once", async () => {
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
    ]);
  });
});
