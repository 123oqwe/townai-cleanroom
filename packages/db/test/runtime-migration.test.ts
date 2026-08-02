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

describe("persistent runtime migration", () => {
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
      ]),
    );
    expect(indexes.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining([
        "runtime_jobs_claim_idx",
        "runtime_sessions_owner_state_activity_idx",
        "session_events_owner_session_sequence_idx",
        "session_runs_owner_session_created_idx",
      ]),
    );
    expect(triggers.map(({ trigger_name }) => trigger_name)).toEqual(
      expect.arrayContaining(["session_events_immutable_update"]),
    );
  });

  it("applies all four migrations exactly once", async () => {
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
    ]);
  });
});
