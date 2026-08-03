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
  createRoutineResultRepository,
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
  await sql`insert into agent_versions (id,owner_id,agent_id,version,snapshot,created_by) values (${versionId},${ownerId},${agentId},1,${sql.json({ displayName: "Routine", instructions: "test", defaultApprovalMode: "require_approval", callableRoutineIds: [] })},'user')`;
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
    const trigger = await repo.createTrigger({
      ownerId,
      routineScheduleId: schedule.id,
      kind: "incoming_email",
      config: { accountId: "account-1", label: "inbox" },
    });
    expect(await repo.listTriggers(ownerId, schedule.id)).toEqual([trigger]);
    const updatedTrigger = await repo.updateTrigger({
      ownerId,
      triggerId: trigger.id,
      expectedRevision: 1,
      config: { accountId: "account-1", label: "important" },
      enabled: false,
    });
    expect(updatedTrigger).toMatchObject({ revision: 2, enabled: false });
    await expect(
      repo.removeTrigger(ownerId, trigger.id, 1),
    ).rejects.toMatchObject({ code: "ROUTINE_CONFLICT" });
    await repo.removeTrigger(ownerId, trigger.id, 2);
    expect(await repo.listTriggers(ownerId, schedule.id)).toEqual([]);
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
    const updated = await repo.update({
      ownerId,
      id: schedule.id,
      expectedRevision: 2,
      name: "Morning sync updated",
      cron: "15 8 * * *",
      timezone: "Asia/Shanghai",
      nextRunAt: new Date("2026-08-03T00:15:00Z"),
      enabled: true,
    });
    expect(updated).toMatchObject({
      name: "Morning sync updated",
      revision: 3,
    });
    await expect(
      repo.update({
        ownerId,
        id: schedule.id,
        expectedRevision: 2,
        name: "stale",
        cron: "0 0 * * *",
        timezone: "UTC",
        nextRunAt: new Date("2026-08-03T00:00:00Z"),
        enabled: true,
      }),
    ).rejects.toMatchObject({ code: "ROUTINE_CONFLICT" });
    await expect(repo.remove(ownerId, schedule.id, 3)).rejects.toMatchObject({
      code: "ROUTINE_CONFLICT",
    });
    const disposable = await repo.create({
      ownerId,
      agentId,
      agentVersionId: versionId,
      name: "Disposable schedule",
      cron: "0 12 * * *",
      nextRunAt: new Date("2026-08-03T12:00:00Z"),
    });
    await repo.remove(ownerId, disposable.id, 1);
    expect((await repo.list(ownerId)).map(({ id }) => id)).toEqual([
      schedule.id,
    ]);
  });

  it("creates expiring public shares without exposing the token hash", async () => {
    const repo = createRoutineRepository(sql);
    const schedule = await repo.create({
      ownerId,
      agentId,
      agentVersionId: versionId,
      name: "Shared briefing",
      cron: "0 9 * * 1-5",
      nextRunAt: new Date("2026-08-03T01:00:00Z"),
    });
    const result = await repo.createShare({
      ownerId,
      routineScheduleId: schedule.id,
      expiresAt: new Date("2099-01-01T00:00:00Z"),
    });
    expect(result.token).toMatch(/^rtnshare_/);
    expect(result.share).toMatchObject({
      ownerId,
      routineScheduleId: schedule.id,
      revokedAt: null,
    });
    const publicShare = await repo.getPublicShare(result.token);
    expect(publicShare).toMatchObject({
      shareId: result.share.id,
      routine: { id: schedule.id, name: "Shared briefing" },
      version: { snapshot: { instructions: "test", callableRoutineIds: [] } },
    });
    const raw = await sql<{ token_hash: Buffer }[]>`
      select token_hash from routine_share_grants where id=${result.share.id}
    `;
    expect(raw[0]?.token_hash.toString()).not.toContain(result.token);
    await repo.revokeShare(ownerId, result.share.id);
    expect(await repo.getPublicShare(result.token)).toBeNull();
  });

  it("installs a shared Routine atomically without inheriting child routines", async () => {
    const targetOwnerId = newId<"user">();
    await sql`insert into users (id,email,timezone) values (${targetOwnerId},'routine-target@example.invalid','UTC')`;
    const repo = createRoutineRepository(sql);
    const source = await repo.create({
      ownerId,
      agentId,
      agentVersionId: versionId,
      name: "Installable briefing",
      cron: "0 9 * * 1-5",
      nextRunAt: new Date("2026-08-03T01:00:00Z"),
    });
    const { token } = await repo.createShare({
      ownerId,
      routineScheduleId: source.id,
      expiresAt: new Date("2099-01-01T00:00:00Z"),
    });
    const installed = await repo.installShare({
      ownerId: targetOwnerId,
      token,
      name: "Copied briefing",
      nextRunAt: new Date("2026-08-04T01:00:00Z"),
    });
    expect(installed.routine).toMatchObject({
      ownerId: targetOwnerId,
      name: "Copied briefing",
      cron: source.cron,
      timezone: source.timezone,
    });
    const [copied] = await sql<{ snapshot: Record<string, unknown> }[]>`
      select version.snapshot
      from agent_versions version
      where version.owner_id=${targetOwnerId}
        and version.agent_id=${installed.routine.agentId}
    `;
    expect(copied?.snapshot).toMatchObject({ callableRoutineIds: [] });
    await expect(
      repo.installShare({
        ownerId: targetOwnerId,
        token: "rtnshare_invalid_token_123456",
        nextRunAt: new Date("2026-08-04T01:00:00Z"),
      }),
    ).rejects.toMatchObject({ code: "SHARE_NOT_FOUND" });
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

  it("persists one auditable result per runtime run and lists it by session", async () => {
    const threadId = newId<"thread">();
    const sessionId = newId<"runtime-session">();
    const runId = newId<"session-run">();
    const turnId = newId<"thread-turn">();
    await sql`insert into threads (id,owner_id,agent_id,kind,title,approval_mode) values (${threadId},${ownerId},${agentId},'task','Result thread','require_approval')`;
    await sql`insert into thread_turns (id,owner_id,thread_id,sequence,role,text,source_type) values (${turnId},${ownerId},${threadId},1,'user','run','user')`;
    await sql`insert into runtime_sessions (id,owner_id,thread_id,agent_id,agent_version_id) values (${sessionId},${ownerId},${threadId},${agentId},${versionId})`;
    await sql`insert into session_runs (id,owner_id,session_id,thread_id,triggering_turn_id,idempotency_hash,request_fingerprint,state,attempt,started_at) values (${runId},${ownerId},${sessionId},${threadId},${turnId},decode('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','hex'),decode('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','hex'),'running',1,now())`;
    const repository = createRoutineResultRepository(sql);
    const result = await repository.complete({
      ownerId,
      sessionId,
      runId,
      routineScheduleId: null,
      subject: "Weekly briefing",
      output: { documentId: "doc-1", notificationId: "notice-1" },
    });
    expect(result).toMatchObject({
      ownerId,
      sessionId,
      runId,
      status: "completed",
      subject: "Weekly briefing",
      output: { documentId: "doc-1", notificationId: "notice-1" },
    });
    await expect(
      repository.complete({
        ownerId,
        sessionId,
        runId,
        routineScheduleId: null,
        subject: "Changed",
        output: {},
      }),
    ).resolves.toMatchObject({ id: result.id, subject: "Weekly briefing" });
    await expect(
      repository.listForSession(ownerId, sessionId),
    ).resolves.toEqual([
      expect.objectContaining({ id: result.id, subject: "Weekly briefing" }),
    ]);
    await expect(repository.getForRun(ownerId, runId)).resolves.toMatchObject({
      id: result.id,
      sessionId,
      runId,
      status: "completed",
    });
  });

  it("stores webhook payload as typed trigger data with its idempotency key", async () => {
    const repository = createRoutineRepository(sql);
    const schedule = await repository.create({
      ownerId,
      agentId,
      agentVersionId: versionId,
      name: "Webhook briefing",
      cron: "0 9 * * *",
      nextRunAt: new Date("2026-08-03T01:00:00Z"),
    });
    const { secret } = await repository.createWebhook(ownerId, schedule.id);
    const delivery = await repository.deliverWebhook(
      schedule.id,
      secret,
      "event-typed",
      {
        event: "ping",
      },
    );
    expect(delivery).not.toBeNull();
    if (delivery === null) throw new Error("expected webhook delivery");
    const [run] = await sql<
      {
        trigger_type: string;
        trigger_data: Record<string, unknown>;
        idempotency_key: string;
      }[]
    >`select trigger_type,trigger_data,idempotency_key from integration_sync_runs where id=${delivery?.runId}`;
    expect(run).toEqual({
      trigger_type: "webhook",
      trigger_data: { event: "ping" },
      idempotency_key: "event-typed",
    });
  });

  it("claims a queued webhook run once with a lease token", async () => {
    const repository = createRoutineRepository(sql);
    const schedule = await repository.create({
      ownerId,
      agentId,
      agentVersionId: versionId,
      name: "Claimed webhook",
      cron: "0 10 * * *",
      nextRunAt: new Date("2026-08-03T02:00:00Z"),
    });
    const { secret } = await repository.createWebhook(ownerId, schedule.id);
    await repository.deliverWebhook(schedule.id, secret, "claim-once", {
      value: 1,
    });
    const first = await repository.claimQueued(ownerId, "worker-a");
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      triggerType: "webhook",
      triggerData: { value: 1 },
      claimToken: expect.any(String),
    });
    await expect(repository.claimQueued(ownerId, "worker-b")).resolves.toEqual(
      [],
    );
  });

  it("does not allow a webhook secret to cross routine URLs", async () => {
    const repository = createRoutineRepository(sql);
    const first = await repository.create({
      ownerId,
      agentId,
      agentVersionId: versionId,
      name: "Webhook source",
      cron: "0 12 * * *",
      nextRunAt: new Date("2026-08-03T04:00:00Z"),
    });
    const second = await repository.create({
      ownerId,
      agentId,
      agentVersionId: versionId,
      name: "Webhook target",
      cron: "0 13 * * *",
      nextRunAt: new Date("2026-08-03T05:00:00Z"),
    });
    const { secret } = await repository.createWebhook(ownerId, first.id);
    await expect(
      repository.deliverWebhook(second.id, secret, "cross-routine", {
        value: true,
      }),
    ).resolves.toBeNull();
  });

  it("limits a webhook to sixty new deliveries per minute", async () => {
    const repository = createRoutineRepository(sql);
    const schedule = await repository.create({
      ownerId,
      agentId,
      agentVersionId: versionId,
      name: "Rate limited webhook",
      cron: "0 14 * * *",
      nextRunAt: new Date("2026-08-03T06:00:00Z"),
    });
    const { secret } = await repository.createWebhook(ownerId, schedule.id);
    for (let index = 0; index < 60; index += 1)
      await repository.deliverWebhook(schedule.id, secret, `rate-${index}`, {
        index,
      });
    await expect(
      repository.deliverWebhook(schedule.id, secret, "rate-60", { index: 60 }),
    ).rejects.toMatchObject({ code: "WEBHOOK_RATE_LIMITED" });
  });

  it("replays a terminal run into a new queued run without duplicating the source", async () => {
    const repository = createRoutineRepository(sql);
    const schedule = await repository.create({
      ownerId,
      agentId,
      agentVersionId: versionId,
      name: "Replayable routine",
      cron: "0 11 * * *",
      nextRunAt: new Date("2026-08-03T03:00:00Z"),
    });
    const [source] = await repository.claimDue(
      ownerId,
      new Date("2026-08-03T03:00:00Z"),
    );
    if (source === undefined) throw new Error("expected source run");
    await repository.startRun(ownerId, source.claimId);
    await repository.failRun(ownerId, source.claimId, "SOURCE_FAILED");

    const replay = await repository.replayRun(
      ownerId,
      source.claimId,
      "replay-request-1",
    );
    expect(replay).toMatchObject({
      status: "queued",
      routineScheduleId: schedule.id,
      triggerType: "schedule",
      triggerData: { scheduleId: schedule.id },
      idempotencyKey: "replay-request-1",
    });
    expect(replay.id).not.toBe(source.claimId);
    await expect(
      repository.replayRun(ownerId, source.claimId, "replay-request-1"),
    ).resolves.toMatchObject({ id: replay.id });
  });

  it("queues manual and external trigger kinds through one idempotent record", async () => {
    const repository = createRoutineRepository(sql);
    const schedule = await repository.create({
      ownerId,
      agentId,
      agentVersionId: versionId,
      name: "Unified trigger routine",
      cron: "0 12 * * *",
      nextRunAt: new Date("2026-08-03T04:00:00Z"),
    });
    const manual = await repository.queueTrigger(
      ownerId,
      schedule.id,
      "manual",
      { input: "run now" },
      "manual-1",
    );
    expect(manual).toMatchObject({
      status: "queued",
      triggerType: "manual",
      triggerData: { input: "run now" },
      idempotencyKey: "manual-1",
    });
    await expect(
      repository.queueTrigger(
        ownerId,
        schedule.id,
        "manual",
        { input: "changed" },
        "manual-1",
      ),
    ).resolves.toMatchObject({
      id: manual.id,
      triggerData: { input: "run now" },
    });
    const calendar = await repository.queueTrigger(
      ownerId,
      schedule.id,
      "calendar",
      { eventId: "event-1" },
      "calendar-1",
    );
    expect(calendar.triggerType).toBe("calendar");
    const voice = await repository.queueTrigger(
      ownerId,
      schedule.id,
      "voice_transcribed",
      { transcript: "Call summary" },
      "voice-1",
    );
    const slack = await repository.queueTrigger(
      ownerId,
      schedule.id,
      "slack_mention",
      { channelId: "C123", text: "Please review this." },
      "slack-1",
    );
    expect(voice.triggerType).toBe("voice_transcribed");
    expect(slack.triggerType).toBe("slack_mention");
  });
});
