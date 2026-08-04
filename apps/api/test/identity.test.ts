import { randomBytes } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
} from "vitest";
import { runMigrations } from "@town/db";
import { newId } from "@town/contracts";
import {
  createAccountRepository,
  createCredentialCipher,
  createIdentityService,
} from "@town/identity";
import postgres, { type Sql } from "postgres";

import { createApp } from "../src/app.js";
import { createChannelRepository } from "@town/channels";
import { createOperationsRepository } from "@town/operations";
import { createBillingRepository } from "@town/billing";

let sql: Sql;

beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 4 });
  await runMigrations(sql);
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  await sql`truncate connected_accounts, oauth_credentials, auth_sessions, users, access_allowlist, agents, agent_versions, routine_schedules, routine_triggers, integration_sync_runs, routine_webhooks, routine_webhook_deliveries, routine_share_grants, routine_results cascade`;
});

async function fixture() {
  await sql`
    insert into access_allowlist (email, enabled)
    values ('owner@example.test', true), ('other@example.test', true)
  `;
  const identityService = createIdentityService(sql);
  const accountRepository = createAccountRepository(
    sql,
    createCredentialCipher(randomBytes(32).toString("base64url")),
  );
  const owner = await identityService.establishIdentity({
    email: "owner@example.test",
    firstName: "Town",
    lastName: "Owner",
    timezone: "Asia/Shanghai",
  });
  const other = await identityService.establishIdentity({
    email: "other@example.test",
    timezone: "UTC",
  });
  await accountRepository.create({
    ownerId: owner.user.id,
    provider: "google",
    providerUserId: "owner-google",
    email: "owner@gmail.test",
    capabilities: { email: "read_write" },
    credential: {
      accessToken: "private-access-token",
      refreshToken: "private-refresh-token",
      scopes: ["email"],
    },
  });
  await accountRepository.create({
    ownerId: other.user.id,
    provider: "google",
    providerUserId: "other-google",
    email: "other@gmail.test",
    capabilities: {},
    credential: { accessToken: "other-private-token", scopes: [] },
  });

  return {
    app: createApp({
      sql,
      identityService,
      accountRepository,
      channelRepository: createChannelRepository(sql),
      operationsRepository: createOperationsRepository(sql),
      billingRepository: createBillingRepository(sql),
      adminAllowlistEmails: ["owner@example.test"],
    }),
    identityService,
    owner,
    other,
  };
}

async function seedRoutineAdminData(ownerId: string) {
  const routineAgentId = newId<"agent">();
  const routineVersionId = newId<"agent-version">();
  const routineId = newId<"routine-schedule">();
  const routineDisabledId = newId<"routine-schedule">();
  const triggerOneId = newId<"routine-trigger">();
  const triggerTwoId = newId<"routine-trigger">();
  const runQueuedId = newId<"integration-sync-run">();
  const runRunningId = newId<"integration-sync-run">();
  const runSucceededId = newId<"integration-sync-run">();
  const runFailedId = newId<"integration-sync-run">();
  const runBlockedId = newId<"integration-sync-run">();
  const webhookEnabledId = newId<"routine-webhook">();
  const webhookDisabledId = newId<"routine-webhook">();
  const webhookDeliveryRecentId = newId<"routine-webhook-delivery">();
  const webhookDeliveryStaleId = newId<"routine-webhook-delivery">();
  const shareActiveId = newId<"routine-share">();
  const shareRevokedId = newId<"routine-share">();
  const shareExpiredId = newId<"routine-share">();
  const tokenHashActive = "11".repeat(32);
  const tokenHashDisabled = "22".repeat(32);
  const shareTokenActive = "33".repeat(32);
  const shareTokenRevoked = "44".repeat(32);
  const shareTokenExpired = "55".repeat(32);

  await sql`insert into agents (id,owner_id,kind,revision,status) values (${routineAgentId},${ownerId},'routine',1,'active')`;
  await sql`insert into agent_versions (id,owner_id,agent_id,version,snapshot,created_by) values (${routineVersionId},${ownerId},${routineAgentId},1,'{}','system')`;
  await sql`update agents set active_version_id=${routineVersionId} where owner_id=${ownerId} and id=${routineAgentId}`;

  await sql`
    insert into routine_schedules
      (id, owner_id, agent_id, agent_version_id, name, cron, timezone, enabled, next_run_at, last_run_at)
    values
      (${routineId}, ${ownerId}, ${routineAgentId}, ${routineVersionId}, 'Morning brief','0 9 * * *','UTC',true,now()-interval '1 hour',now()-interval '1 hour'),
      (${routineDisabledId}, ${ownerId}, ${routineAgentId}, ${routineVersionId}, 'Weekend check','30 0 * * 1-5','UTC',false,now()+interval '2 hours',now()-interval '40 days')
  `;

  await sql`
    insert into routine_triggers (id, owner_id, routine_schedule_id, kind, config, enabled)
    values
      (${triggerOneId}, ${ownerId}, ${routineId}, 'manual', '{}'::jsonb, true),
      (${triggerTwoId}, ${ownerId}, ${routineDisabledId}, 'email_to_assistant', '{}'::jsonb, false)
  `;

  await sql`
    insert into integration_sync_runs
      (id, owner_id, account_id, routine_schedule_id, provider, status, trigger_type, trigger_data, finished_at)
    values
      (${runQueuedId}, ${ownerId}, (select id from connected_accounts where owner_id=${ownerId} limit 1), ${routineId}, 'google', 'queued', 'schedule', '{}'::jsonb, null),
      (${runRunningId}, ${ownerId}, (select id from connected_accounts where owner_id=${ownerId} limit 1), ${routineId}, 'google', 'running', 'manual', '{}'::jsonb, null),
      (${runSucceededId}, ${ownerId}, (select id from connected_accounts where owner_id=${ownerId} limit 1), ${routineId}, 'calendar', 'succeeded', 'webhook', '{}'::jsonb, now()),
      (${runFailedId}, ${ownerId}, (select id from connected_accounts where owner_id=${ownerId} limit 1), ${routineDisabledId}, 'calendar', 'failed', 'webhook', '{}'::jsonb, null),
      (${runBlockedId}, ${ownerId}, (select id from connected_accounts where owner_id=${ownerId} limit 1), ${routineDisabledId}, 'google', 'blocked', 'voice_transcribed', '{}'::jsonb, null)
  `;

  await sql`
    insert into routine_webhooks (id, owner_id, routine_schedule_id, token_hash, enabled)
    values
      (${webhookEnabledId}, ${ownerId}, ${routineId}, decode(${tokenHashActive}, 'hex'), true),
      (${webhookDisabledId}, ${ownerId}, ${routineDisabledId}, decode(${tokenHashDisabled}, 'hex'), false)
  `;

  await sql`
    insert into routine_webhook_deliveries (id, owner_id, webhook_id, idempotency_key, payload, run_id, created_at)
    values
      (${webhookDeliveryRecentId}, ${ownerId}, ${webhookEnabledId}, 'recent-key', '{}'::jsonb, ${runQueuedId}, now()),
      (${webhookDeliveryStaleId}, ${ownerId}, ${webhookEnabledId}, 'stale-key', '{}'::jsonb, ${runRunningId}, now()-interval '2 days')
  `;

  await sql`
    insert into routine_share_grants (id, owner_id, routine_schedule_id, token_hash, revoked_at, expires_at)
    values
      (${shareActiveId}, ${ownerId}, ${routineId}, decode(${shareTokenActive}, 'hex'), null, null),
      (${shareRevokedId}, ${ownerId}, ${routineId}, decode(${shareTokenRevoked}, 'hex'), now()-interval '2 hours', null),
      (${shareExpiredId}, ${ownerId}, ${routineDisabledId}, decode(${shareTokenExpired}, 'hex'), null, now()+interval '30 minutes')
  `;
  await sql`
    update routine_share_grants
      set expires_at = now()-interval '1 hour',
          created_at = now()-interval '2 hours'
      where id=${shareExpiredId}
  `;
}

describe("protected identity API", () => {
  it("establishes a bearer session only for an allowlisted email", async () => {
    await sql`
      insert into access_allowlist (email, enabled)
      values ('signin@example.test', true)
    `;
    const identityService = createIdentityService(sql);
    const app = createApp({
      identityService,
      accountRepository: createAccountRepository(
        sql,
        createCredentialCipher(randomBytes(32).toString("base64url")),
      ),
    });
    const response = await app.request("/v1/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "signin@example.test",
        firstName: "Sign",
        timezone: "Asia/Shanghai",
      }),
    });
    const body = (await response.json()) as {
      token: string;
      user: { email: string; firstName?: string };
      session: { expiresAt: string };
    };
    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      user: { email: "signin@example.test", firstName: "Sign" },
      session: { expiresAt: expect.any(String) },
    });
    expect(body.token).toMatch(/^town_session_/);
    expect(JSON.stringify(body)).not.toContain("accessToken");
  });

  it("does not establish a session for an unallowlisted email", async () => {
    const identityService = createIdentityService(sql);
    const app = createApp({
      identityService,
      accountRepository: createAccountRepository(
        sql,
        createCredentialCipher(randomBytes(32).toString("base64url")),
      ),
    });
    const response = await app.request("/v1/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "not-allowed@example.test" }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "ACCESS_DENIED" });
  });

  it.each([undefined, "Basic value", "Bearer malformed"])(
    "rejects missing or invalid authorization %s",
    async (authorization) => {
      const { app } = await fixture();
      const headers =
        authorization === undefined ? {} : { Authorization: authorization };

      const response = await app.request("/v1/me", { headers });

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        status: 401,
        code: "UNAUTHENTICATED",
      });
    },
  );

  it("returns only the authenticated safe user projection", async () => {
    const { app, owner } = await fixture();
    const response = await app.request("/v1/me", {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ user: owner.user });
    expect(JSON.stringify(body)).not.toContain(owner.token);
    expect(body).not.toHaveProperty("session");
  });

  it("lists only owner accounts without credentials or envelopes", async () => {
    const { app, owner } = await fixture();
    const response = await app.request("/v1/accounts", {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    const body = (await response.json()) as {
      accounts: Record<string, unknown>[];
    };
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0]).toMatchObject({
      email: "owner@gmail.test",
      credentialPresent: true,
    });
    expect(serialized).not.toMatch(
      /credentialId|envelope|accessToken|refreshToken/,
    );
    expect(serialized).not.toContain("other@gmail.test");
  });

  it("protects credential mutation routes, not only account listing", async () => {
    const { app, owner } = await fixture();
    const accountResponse = await app.request("/v1/accounts", {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    const account = (await accountResponse.json()) as {
      accounts: Array<{ id: string }>;
    };
    const response = await app.request(
      `/v1/accounts/${account.accounts[0]?.id}/credential`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accessToken: "should-not-reach-route",
          scopes: [],
        }),
      },
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("rejects a revoked session", async () => {
    const { app, identityService, owner } = await fixture();
    await identityService.revokeSession(owner.session.id, owner.user.id);

    const response = await app.request("/v1/accounts", {
      headers: { Authorization: `Bearer ${owner.token}` },
    });

    expect(response.status).toBe(401);
  });

  it("protects notification delivery replay routes", async () => {
    const { app } = await fixture();
    const response = await app.request(
      "/v1/notification-deliveries/01900000-0000-7000-8000-000000000000/replay",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: "replay-unauthenticated" }),
      },
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("protects the notification timeline route", async () => {
    const { app } = await fixture();
    const response = await app.request("/v1/notification-timeline");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("lets the authenticated user revoke the current session", async () => {
    const { app, owner } = await fixture();
    const response = await app.request("/v1/me/session", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(response.status).toBe(204);
    const after = await app.request("/v1/me", {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(after.status).toBe(401);
  });

  it("exposes safe agent health only to the deployment admin allowlist", async () => {
    const { app, owner, other } = await fixture();
    const overviewResponse = await app.request("/v1/admin/overview", {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(overviewResponse.status).toBe(200);
    expect(await overviewResponse.json()).toMatchObject({
      readiness: {
        api: true,
        harness: false,
        worker: false,
        googleOAuth: false,
      },
      counts: {
        users: { total: 2, active: 2 },
        connectedAccounts: 2,
        activeSessions: 0,
        queuedRuns: 0,
        failedRuns: 0,
        pendingApprovals: 0,
        queuedDeliveries: 0,
        failedDeliveries: 0,
        activeSquares: 0,
        failedAuditEvents24h: 0,
      },
    });
    const response = await app.request(
      `/v1/admin/agent-health/${other.user.id}`,
      { headers: { Authorization: `Bearer ${owner.token}` } },
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      user: { id: other.user.id, email: other.user.email, status: "active" },
      readiness: {
        api: true,
        harness: false,
        worker: false,
        googleOAuth: false,
      },
      summary: {
        activeSessions: 0,
        queuedRuns: 0,
        failedRuns: 0,
        pendingApprovals: 0,
        queuedDeliveries: 0,
        failedDeliveries: 0,
      },
    });
    expect(JSON.stringify(body)).not.toContain(owner.token);

    const detailResponse = await app.request(
      `/v1/admin/users/${other.user.id}`,
      { headers: { Authorization: `Bearer ${owner.token}` } },
    );
    const detail = await detailResponse.json();
    expect(detailResponse.status).toBe(200);
    expect(detail).toMatchObject({
      user: { id: other.user.id, email: other.user.email },
      resources: {
        hasProfile: false,
        activeAgents: 0,
        activeThreads: 0,
        openTasks: 0,
      },
      accounts: [
        {
          provider: "google",
          email: "other@gmail.test",
          isActive: true,
          credentialPresent: true,
        },
      ],
    });

    const squareId = newId<"square">();
    await sql`
      insert into squares (id,owner_id,name,slug,description)
      values (${squareId},${other.user.id},'Admin test team','admin-test-team','Safe team detail')
    `;
    await sql`
      insert into square_memberships (square_id,user_id,owner_id,role,status)
      values (${squareId},${other.user.id},${other.user.id},'owner','active')
    `;
    const teamResponse = await app.request(`/v1/admin/teams/${squareId}`, {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    const team = await teamResponse.json();
    expect(teamResponse.status).toBe(200);
    expect(team).toMatchObject({
      square: { id: squareId, slug: "admin-test-team", status: "active" },
      owner: { id: other.user.id, email: other.user.email },
      membershipCounts: { active: 1, invited: 0, suspended: 0 },
      policy: null,
    });

    const denied = await app.request(
      `/v1/admin/agent-health/${owner.user.id}`,
      { headers: { Authorization: `Bearer ${other.token}` } },
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "ADMIN_NOT_AUTHORIZED" });
  });

  it("exposes admin reports by slug without leaking credentials", async () => {
    const { app, owner } = await fixture();

    const overviewResponse = await app.request("/v1/admin/reports/overview", {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    const overview = (await overviewResponse.json()) as {
      slug: string;
      generatedAt: string;
      readiness: {
        api: boolean;
        harness: boolean;
        worker: boolean;
        googleOAuth: boolean;
      };
      counts: Record<string, unknown>;
    };

    const runtimeResponse = await app.request("/v1/admin/reports/runtime", {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    const runtime = (await runtimeResponse.json()) as {
      slug: string;
      generatedAt: string;
      readiness: {
        api: boolean;
        harness: boolean;
        worker: boolean;
        googleOAuth: boolean;
      };
      period: { start: string; end: string };
      totals: {
        sessions: Record<string, unknown>;
        runs: Record<string, unknown>;
      };
    };

    const contentResponse = await app.request("/v1/admin/reports/content", {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    const content = (await contentResponse.json()) as {
      slug: string;
      generatedAt: string;
      readiness: {
        api: boolean;
        harness: boolean;
        worker: boolean;
        googleOAuth: boolean;
      };
      period: { start: string; end: string };
      counts: {
        items: Record<string, unknown>;
        shares: Record<string, unknown>;
      };
    };

    expect(overviewResponse.status).toBe(200);
    expect(runtimeResponse.status).toBe(200);
    expect(contentResponse.status).toBe(200);

    expect(overview).toMatchObject({
      slug: "overview",
      readiness: {
        api: true,
        harness: false,
        worker: false,
        googleOAuth: false,
      },
      counts: { users: { total: 2, active: 2 }, connectedAccounts: 2 },
    });
    expect(runtime).toMatchObject({
      slug: "runtime",
      period: { start: expect.any(String), end: expect.any(String) },
      totals: {
        sessions: {
          running: expect.any(Number),
          waitingForApproval: expect.any(Number),
          waitingForInput: expect.any(Number),
          failed: expect.any(Number),
          cancelled: expect.any(Number),
        },
        runs: {
          queued: expect.any(Number),
          running: expect.any(Number),
          waitingApproval: expect.any(Number),
          waitingInput: expect.any(Number),
          failed: expect.any(Number),
          cancelled: expect.any(Number),
          succeeded: expect.any(Number),
        },
      },
    });
    expect(content).toMatchObject({
      slug: "content",
      period: { start: expect.any(String), end: expect.any(String) },
      counts: {
        items: {
          total: expect.any(Number),
          active: expect.any(Number),
          archived: expect.any(Number),
          deleted: expect.any(Number),
          sessionItems: expect.any(Number),
        },
        shares: { total: expect.any(Number), active: expect.any(Number) },
      },
    });

    const serializedOverview = JSON.stringify(overview);
    const serializedRuntime = JSON.stringify(runtime);
    const serializedContent = JSON.stringify(content);

    expect(serializedOverview).not.toContain("credential");
    expect(serializedRuntime).not.toContain("credential");
    expect(serializedContent).not.toContain("credential");
    expect(serializedOverview).not.toContain(owner.token);
    expect(serializedRuntime).not.toContain(owner.token);
    expect(serializedContent).not.toContain(owner.token);
  });

  it("exposes routine admin reports by slug with real aggregate data", async () => {
    const { app, owner } = await fixture();
    await seedRoutineAdminData(owner.user.id);

    const headers = { Authorization: `Bearer ${owner.token}` };
    const [overviewResponse, schedulesResponse, triggersResponse, runsResponse, webhooksResponse, sharesResponse] = await Promise.all([
      app.request("/v1/admin/routines/overview", { headers }),
      app.request("/v1/admin/routines/schedules", { headers }),
      app.request("/v1/admin/routines/triggers", { headers }),
      app.request("/v1/admin/routines/runs", { headers }),
      app.request("/v1/admin/routines/webhooks", { headers }),
      app.request("/v1/admin/routines/shares", { headers }),
    ]);

    const overview = (await overviewResponse.json()) as {
      slug: string;
      counts: {
        routines: { total: number; enabled: number; disabled: number };
        triggers: { total: number; enabled: number };
        runs: { queued: number; running: number; succeeded: number; failed: number; blocked: number };
        webhooks: { total: number; enabled: number };
        shares: { total: number; active: number; revoked: number };
      };
    };
    const schedules = (await schedulesResponse.json()) as {
      slug: string;
      counts: {
        routines: { total: number; enabled: number; disabled: number; overdue: number; dueIn24h: number };
        lifecycle: { createdInPeriod: number; updatedInPeriod: number; staleLastRun: number };
      };
    };
    const triggers = (await triggersResponse.json()) as {
      slug: string;
      counts: {
        total: number;
        enabled: number;
        disabled: number;
        createdInPeriod: number;
        byKind: {
          manual: number;
          emailToAssistant: number;
          calendarStart: number;
        };
      };
    };
    const runs = (await runsResponse.json()) as {
      slug: string;
      totals: {
        all: {
          total: number;
          queued: number;
          running: number;
          succeeded: number;
          failed: number;
          blocked: number;
        };
        byProvider: { google: number; calendar: number; other: number };
        byTriggerType: { webhook: number; voiceTranscribed: number };
        byPeriod: { succeeded: number; failed: number };
      };
    };
    const webhooks = (await webhooksResponse.json()) as {
      slug: string;
      counts: {
        webhooks: { total: number; enabled: number; disabled: number };
        deliveries: { total: number; inPeriod: number; inLast24h: number };
      };
    };
    const shares = (await sharesResponse.json()) as {
      slug: string;
      counts: {
        shares: { total: number; active: number; revoked: number; expired: number };
        byPeriod: { created: number; revoked: number; expired: number };
      };
    };

    expect(overviewResponse.status).toBe(200);
    expect(schedulesResponse.status).toBe(200);
    expect(triggersResponse.status).toBe(200);
    expect(runsResponse.status).toBe(200);
    expect(webhooksResponse.status).toBe(200);
    expect(sharesResponse.status).toBe(200);

    expect(overview.slug).toBe("overview");
    expect(overview.counts).toMatchObject({
      routines: { total: 2, enabled: 1, disabled: 1 },
      triggers: { total: 2, enabled: 1 },
      runs: { queued: 1, running: 1, succeeded: 1, failed: 1, blocked: 1 },
      webhooks: { total: 2, enabled: 1 },
      shares: { total: 3, active: 1, revoked: 1 },
    });

    expect(schedules.counts.routines).toMatchObject({
      total: 2,
      enabled: 1,
      disabled: 1,
      overdue: 1,
      dueIn24h: 1,
    });
    expect(schedules.counts.lifecycle).toMatchObject({
      createdInPeriod: 2,
      updatedInPeriod: 2,
      staleLastRun: 1,
    });

    expect(triggers.slug).toBe("triggers");
    expect(triggers.counts).toMatchObject({
      total: 2,
      enabled: 1,
      disabled: 1,
      createdInPeriod: 2,
      byKind: { manual: 1, emailToAssistant: 1 },
    });

    expect(runs.slug).toBe("runs");
    expect(runs.totals).toMatchObject({
      all: { total: 5, queued: 1, running: 1, succeeded: 1, failed: 1, blocked: 1 },
      byProvider: { google: 3, calendar: 2, other: 0 },
      byTriggerType: { webhook: 2, voiceTranscribed: 1 },
      byPeriod: { succeeded: 1, failed: 1 },
    });

    expect(webhooks.slug).toBe("webhooks");
    expect(webhooks.counts).toMatchObject({
      webhooks: { total: 2, enabled: 1, disabled: 1 },
      deliveries: { total: 2, inPeriod: 2, inLast24h: 1 },
    });

    expect(shares.slug).toBe("shares");
    expect(shares.counts).toMatchObject({
      shares: { total: 3, active: 1, revoked: 1, expired: 1 },
      byPeriod: { created: 3, revoked: 1, expired: 1 },
    });

    expect(JSON.stringify(overview)).not.toContain("credential");
    expect(JSON.stringify(schedules)).not.toContain("credential");
    expect(JSON.stringify(triggers)).not.toContain("credential");
    expect(JSON.stringify(runs)).not.toContain("credential");
    expect(JSON.stringify(webhooks)).not.toContain("credential");
    expect(JSON.stringify(shares)).not.toContain("credential");
  });

  it("rejects unknown routine admin report slug explicitly", async () => {
    const { app, owner } = await fixture();
    const response = await app.request("/v1/admin/routines/does-not-exist", {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "REPORT_NOT_FOUND" });
  });

  it("rejects unknown admin report slug explicitly", async () => {
    const { app, owner } = await fixture();
    const response = await app.request("/v1/admin/reports/does-not-exist", {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "REPORT_NOT_FOUND" });
  });

  it("keeps admin billing reconciliation explicit when no external provider exists", async () => {
    const { app, owner, other } = await fixture();
    const response = await app.request(
      `/v1/admin/billing-reconciliation/${other.user.id}`,
      { headers: { Authorization: `Bearer ${owner.token}` } },
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      user: { id: other.user.id, email: other.user.email },
      status: "not_configured",
      billing: null,
      usage: [],
      reconciliation: {
        externalProvider: "not_configured",
        discrepancy: null,
      },
    });
  });
});
