import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
} from "vitest";
import postgres, { type Sql } from "postgres";
import { newId, type Id } from "@town/contracts";
import { runMigrations } from "@town/db";
import { createRoutineRepository } from "../src/index.js";

let sql: Sql;
let ownerId: Id<"user">;
let agentId: Id<"agent">;
let versionId: Id<"agent-version">;
let accountId: Id<"connected-account">;
beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 4 });
  await runMigrations(sql);
});
beforeEach(async () => {
  await sql`truncate table users cascade`;
  ownerId = newId<"user">();
  agentId = newId<"agent">();
  versionId = newId<"agent-version">();
  accountId = newId<"connected-account">();
  await sql`insert into users (id,email,timezone) values (${ownerId},'routine@example.invalid','UTC')`;
  await sql`insert into agents (id,owner_id,kind,status) values (${agentId},${ownerId},'routine','active')`;
  await sql`insert into agent_versions (id,owner_id,agent_id,version,snapshot,created_by) values (${versionId},${ownerId},${agentId},1,${sql.json({ displayName: "Routine", instructions: "test", defaultApprovalMode: "require_approval" })},'user')`;
  await sql`update agents set active_version_id=${versionId} where id=${agentId}`;
  await sql`insert into connected_accounts (id,owner_id,provider,provider_user_id,email) values (${accountId},${ownerId},'google','routine-user','routine@example.invalid')`;
});
afterAll(async () => {
  await sql.end();
});

describe("routine schedules", () => {
  it("creates owner-scoped routine and claims due work into a sync run", async () => {
    const repo = createRoutineRepository(sql);
    const schedule = await repo.create({
      ownerId,
      agentId,
      agentVersionId: versionId,
      name: "Morning sync",
      cron: "0 8 * * *",
      nextRunAt: new Date("2026-08-02T08:00:00Z"),
    });
    expect(schedule).toMatchObject({ ownerId, agentId, enabled: true });
    const claimed = await repo.claimDue(
      ownerId,
      new Date("2026-08-02T09:00:00Z"),
    );
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.id).toBe(schedule.id);
    const runs = await sql<
      { status: string; routine_schedule_id: string }[]
    >`select status,routine_schedule_id from integration_sync_runs where owner_id=${ownerId}`;
    expect(runs).toEqual([
      { status: "queued", routine_schedule_id: schedule.id },
    ]);
  });
});
