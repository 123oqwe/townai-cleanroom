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
import {
  createRoutineRepository,
  createRoutineStepRepository,
} from "../src/index.js";

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

  it("caches a step per owner/run/key and never reruns a completed step", async () => {
    const repo = createRoutineStepRepository(sql);
    const runId = newId<"integration-sync-run">();
    await sql`insert into integration_sync_runs (id, owner_id, account_id, provider) values (${runId}, ${ownerId}, ${accountId}, 'google')`;
    const first = await repo.begin({
      ownerId,
      runId,
      stepKey: "collect-email",
    });
    expect(first).toMatchObject({
      acquired: true,
      result: { status: "running" },
    });

    const duplicate = await repo.begin({
      ownerId,
      runId,
      stepKey: "collect-email",
    });
    expect(duplicate).toMatchObject({
      acquired: false,
      result: { status: "running" },
    });
    await repo.complete({
      ownerId,
      runId,
      stepKey: "collect-email",
      output: { count: 2 },
    });

    const resumed = await repo.begin({
      ownerId,
      runId,
      stepKey: "collect-email",
    });
    expect(resumed).toMatchObject({
      acquired: false,
      result: { status: "completed", output: { count: 2 } },
    });
    await expect(
      repo.complete({ ownerId, runId, stepKey: "collect-email", output: {} }),
    ).rejects.toThrow("ROUTINE_STEP_NOT_RUNNING");
  });

  it("records a failed step without exposing another owner's row", async () => {
    const repo = createRoutineStepRepository(sql);
    const otherOwnerId = newId<"user">();
    await sql`insert into users (id,email,timezone) values (${otherOwnerId},'routine-other@example.invalid','UTC')`;
    const runId = newId<"integration-sync-run">();
    await sql`insert into integration_sync_runs (id, owner_id, account_id, provider) values (${runId}, ${ownerId}, ${accountId}, 'google')`;
    await repo.begin({ ownerId, runId, stepKey: "send-email" });
    await repo.fail({
      ownerId,
      runId,
      stepKey: "send-email",
      errorCode: "PROVIDER_TIMEOUT",
      errorMessage: "provider did not respond",
    });
    expect(
      await repo.get({ ownerId: otherOwnerId, runId, stepKey: "send-email" }),
    ).toBeNull();
    expect(
      (await repo.get({ ownerId, runId, stepKey: "send-email" }))?.status,
    ).toBe("failed");
    expect(
      await repo.begin({ ownerId, runId, stepKey: "send-email" }),
    ).toMatchObject({ acquired: true, result: { status: "running" } });
    await expect(
      sql`insert into routine_step_results
          (owner_id, run_id, step_key, status, started_at, finished_at)
        values (${ownerId}, ${runId}, 'invalid-null', 'failed', now(), now())`,
    ).rejects.toThrow();
  });
});
