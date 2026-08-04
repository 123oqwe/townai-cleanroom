import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { z } from "zod";

import { asId } from "@town/contracts";
import type { BillingRepository } from "@town/billing";
import type { OperationsRepository } from "@town/operations";
import type { AuthVariables } from "../src/auth.js";
import { registerAdminRoutes } from "../src/admin-routes.js";

const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");
const otherUserId = asId<"user">("01900000-0000-7000-8000-000000000002");
const routineOwnerId = asId<"user">("01900000-0000-7000-8000-000000000003");
const squareId = asId<"square">("01900000-0000-7000-8000-000000000004");

function withErrorMapping(app: Hono<{ Variables: AuthVariables }>) {
  app.onError((error, context) => {
    if (error instanceof z.ZodError)
      return context.json({ code: "INVALID_REQUEST" }, 400);
    return context.json({ code: "INTERNAL_ERROR", detail: String(error) }, 500);
  });
}

function buildAdminApp(input: {
  sql: ReturnType<typeof vi.fn>;
  operations: OperationsRepository;
  harnessReady?: boolean;
  workerEnabled?: boolean;
  googleOAuthReady?: boolean;
  billing?: BillingRepository;
}) {
  const app = new Hono<{ Variables: AuthVariables }>();
  withErrorMapping(app);
  app.use("*", async (context, next) => {
    context.set("identity", {
      user: { id: ownerId, email: "admin@example.test" },
    });
    await next();
  });
  registerAdminRoutes(app, {
    harnessReady: input.harnessReady ?? true,
    workerEnabled: input.workerEnabled ?? false,
    googleOAuthReady: input.googleOAuthReady ?? false,
    ...input,
  });
  return app;
}

function mockSql() {
  const sql = vi.fn();
  let squareQueryCount = 0;
  sql.mockImplementation(async (query: TemplateStringsArray | string) => {
    const text = (Array.isArray(query) ? query.join(" ") : String(query))
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

    const has = (needle: string) => text.includes(needle);

    if (has("users_total"))
      return [
        {
          users_total: 12,
          users_active: 9,
          connected_accounts_active: 7,
          active_sessions: 3,
          queued_runs: 4,
          failed_runs: 1,
          pending_approvals: 2,
          queued_deliveries: 5,
          failed_deliveries: 1,
          active_squares: 2,
          failed_audit_events_24h: 6,
        },
      ];
    if (has("sessions_running")) {
      if (has("by provider") || has("succeeded as runs_succeeded")) {
        if (has("runtime") && has("session_runs"))
          return [
            {
              runs_total: 18,
              runs_queued: 2,
              runs_running: 3,
              runs_succeeded: 11,
              runs_failed: 1,
              runs_blocked: 1,
              runs_google: 5,
              runs_calendar: 4,
              runs_webhook: 7,
              runs_voice_transcribed: 3,
              runs_failed_period: 0,
              runs_succeeded_period: 4,
              runtimeRunsLinked: 7,
              runtimeRunsLinkedPeriod: 2,
            },
          ];
      }
      return [
        {
          sessions_running: 1,
          sessions_waiting_approval: 1,
          sessions_waiting_input: 1,
          sessions_failed: 0,
          sessions_cancelled: 0,
          runs_queued: 2,
          runs_running: 3,
          runs_failed: 4,
          runs_cancelled: 2,
          runs_succeeded: 11,
          runs_waiting_approval: 2,
          runs_waiting_input: 1,
        },
      ];
    }
    if (has("events_queued")) {
      return [
        {
          deliveries_active: 4,
          deliveries_success: 19,
          deliveries_failed: 2,
          deliveries_replayed: 1,
          events_queued: 3,
          events_attempting: 1,
          events_failed_24h: 0,
          events_succeeded_24h: 6,
        },
      ];
    }
    if (has("approved_last_24h")) {
      return [
        {
          pending_approvals: 2,
          approved_last_24h: 10,
          rejected_last_24h: 1,
          expired_last_24h: 3,
          active_sessions: 4,
          tool_calls_pending: 2,
          tool_calls_running: 1,
        },
      ];
    }
    if (has("teams_total")) {
      if (has("routine_share_grants"))
        return [
          {
            shares_total: 6,
            shares_active: 3,
            shares_revoked: 2,
            shares_expired: 1,
            shares_created: 1,
            shares_revoked_period: 1,
            shares_expired_period: 1,
          },
        ];
      if (has("routines_total") && has("routine_webhooks")) {
        return [
          {
            runs_total: 18,
            routines_total: 5,
            routines_enabled: 3,
            routines_disabled: 2,
            triggers_total: 7,
            triggers_enabled: 5,
            sync_queued: 1,
            sync_running: 1,
            sync_succeeded: 7,
            sync_failed: 1,
            sync_blocked: 1,
            webhooks_total: 4,
            webhooks_enabled: 3,
            shares_total: 6,
            shares_active: 3,
            shares_revoked: 2,
          },
        ];
      }
      return [
        {
          teams_total: 2,
          teams_active: 2,
          members_active: 9,
          members_invited: 4,
          members_suspended: 1,
        },
      ];
    }
    if (has("total_items")) {
      return [
        {
          total_items: 20,
          active_items: 16,
          archived_items: 2,
          deleted_items: 2,
          session_items: 3,
          shared_tokens: 7,
          active_shares: 5,
        },
      ];
    }
    if (has("users_with_billing")) {
      if (has("category='model'"))
        return [{ usage_events_24h: 123, model_events_24h: 45 }];
      return [
        {
          users_with_billing: 8,
          blocked_users: 1,
          warning_users: 2,
          healthy_users: 5,
          usage_entries: 900,
        },
      ];
    }
    if (
      has("routines_total") &&
      has("select count(*)::int from routine_schedules") &&
      has("triggers_enabled") &&
      has("webhooks_enabled") &&
      has("shares_total")
    ) {
      return [
        {
          routines_total: 5,
          routines_enabled: 3,
          routines_disabled: 2,
          triggers_total: 7,
          triggers_enabled: 5,
          sync_queued: 1,
          sync_running: 1,
          sync_succeeded: 7,
          sync_failed: 1,
          sync_blocked: 1,
          webhooks_total: 4,
          webhooks_enabled: 3,
          shares_total: 6,
          shares_active: 3,
          shares_revoked: 2,
        },
      ];
    }
    if (
      has("routines_total") &&
      has("select count(*)::int from routine_schedules")
    ) {
      return [
        {
          routines_total: 5,
          routines_enabled: 4,
          routines_disabled: 1,
          routines_created_period: 1,
          routines_updated_period: 2,
          routines_overdue: 1,
          routines_due_24h: 1,
          routines_stale_last_run: 2,
        },
      ];
    }
    if (
      has("triggers_total") &&
      has("from routine_triggers where kind='slack_mention'")
    ) {
      return [
        {
          triggers_total: 7,
          triggers_enabled: 6,
          triggers_disabled: 1,
          triggers_created_period: 3,
          manual: 1,
          schedule: 1,
          incoming_email: 1,
          outgoing_email: 0,
          email_to_assistant: 2,
          calendar_start: 0,
          calendar_end: 1,
          calendar_rsvp: 0,
          calendar_changed: 1,
          voice_transcribed: 0,
          slack_mention: 1,
          webhook: 0,
        },
      ];
    }
    if (has("routines_total") && has("from routine_webhooks")) {
      return [
        {
          webhooks_total: 4,
          webhooks_enabled: 3,
          webhooks_disabled: 1,
          deliveries_total: 10,
          deliveries_period: 4,
          deliveries_latest: 2,
        },
      ];
    }
    if (has("from users u where u.id")) {
      return [
        {
          id: ownerId,
          email: "owner@example.test",
          status: "active",
          first_name: "Town",
          last_name: "Owner",
          timezone: "Asia/Shanghai",
          created_at: new Date("2026-08-01T00:00:00.000Z"),
          updated_at: new Date("2026-08-02T00:00:00.000Z"),
          has_profile: true,
          agent_count: 2,
          thread_count: 3,
          task_count: 4,
        },
      ];
    }
    if (
      has("select id") &&
      has("users") &&
      has("where id=") &&
      has("created_at")
    ) {
      return [{ id: ownerId, email: "owner@example.test", status: "active" }];
    }
    if (has("from connected_accounts")) {
      return [
        {
          id: asId<"connected-account">("01900000-0000-7000-8000-000000000010"),
          provider: "google",
          email: "owner@gmail.com",
          is_active: true,
          credential_present: true,
        },
        {
          id: asId<"connected-account">("01900000-0000-7000-8000-000000000011"),
          provider: "google",
          email: "owner@work.com",
          is_active: false,
          credential_present: false,
        },
      ];
    }
    if (has("from squares s")) {
      squareQueryCount += 1;
      if (squareQueryCount === 1 || text.includes(squareId)) {
        return [
          {
            id: squareId,
            owner_id: ownerId,
            owner_email: "owner@example.test",
            name: "Demo Square",
            slug: "demo-square",
            description: "Operations test square",
            status: "active",
            created_at: new Date("2026-07-01T00:00:00.000Z"),
            updated_at: new Date("2026-07-25T00:00:00.000Z"),
            active_members: 5,
            invited_members: 1,
            suspended_members: 0,
            policy_mode: "strict",
            policy_revision: 9,
          },
        ];
      }
      return [];
    }
    if (has("select id,email,status from users where id")) {
      return [
        { id: otherUserId, email: "other@example.test", status: "active" },
      ];
    }
    if (has("exists(select 1 from profiles p where p.owner_id=u.id)")) {
      return [
        {
          id: ownerId,
          email: "owner@example.test",
          first_name: "Town",
          last_name: "Owner",
          timezone: "Asia/Shanghai",
          status: "active",
          created_at: new Date("2026-08-01T00:00:00.000Z"),
          updated_at: new Date("2026-08-01T00:00:00.000Z"),
          has_profile: true,
          agent_count: 2,
          thread_count: 3,
          task_count: 4,
        },
      ];
    }
    if (has("from users where id=")) {
      return [{ id: ownerId, email: "owner@example.test" }];
    }
    return [];
  });
  return sql;
}

function operationsSummary() {
  return {
    activeSessions: 3,
    queuedRuns: 4,
    failedRuns: 1,
    pendingApprovals: 2,
    queuedDeliveries: 5,
    failedDeliveries: 1,
  };
}

describe("admin routes", () => {
  const baseOperations = {
    summary: vi.fn().mockResolvedValue(operationsSummary()),
  } as unknown as OperationsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns admin overview and report readiness", async () => {
    const app = buildAdminApp({
      sql: mockSql(),
      operations: baseOperations,
      workerEnabled: true,
      googleOAuthReady: true,
      harnessReady: true,
    });

    const overview = await app.request("/v1/admin/overview");
    const report = await app.request("/v1/admin/reports/overview");

    expect(overview.status).toBe(200);
    expect(report.status).toBe(200);
    expect(await overview.json()).toMatchObject({
      counts: { users: { total: 12, active: 9 }, failedRuns: 1 },
      readiness: { api: true, harness: true, worker: true, googleOAuth: true },
    });
    expect(await report.json()).toMatchObject({
      slug: "overview",
      counts: { users: { total: 12, active: 9 } },
      readiness: { api: true, harness: true, worker: true },
    });
  });

  it("resolves admin reports by slug and validates query period bounds", async () => {
    const app = buildAdminApp({
      sql: mockSql(),
      operations: baseOperations,
      workerEnabled: true,
      googleOAuthReady: false,
      harnessReady: false,
    });

    const runtime = await app.request("/v1/admin/reports/runtime");
    const bad = await app.request(
      "/v1/admin/reports/runtime?start=2026-08-01T00:00:00.000Z&end=2026-07-01T00:00:00.000Z",
    );
    const missing = await app.request("/v1/admin/reports/unknown");
    const billing = await app.request("/v1/admin/reports/billing");

    expect(runtime.status).toBe(200);
    expect(await runtime.json()).toMatchObject({
      slug: "runtime",
      period: {
        start: expect.any(String),
        end: expect.any(String),
      },
      readiness: { worker: true, harness: false, googleOAuth: false },
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "INVALID_REQUEST" });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "REPORT_NOT_FOUND" });
    expect(billing.status).toBe(200);
    expect(await billing.json()).toMatchObject({
      slug: "billing",
      configured: false,
      reconciliation: { externalProvider: "not_configured", discrepancy: null },
    });
  });

  it("resolves routine admin reports and period validation", async () => {
    const app = buildAdminApp({
      sql: mockSql(),
      operations: baseOperations,
    });

    const schedules = await app.request("/v1/admin/routines/schedules");
    const overview = await app.request("/v1/admin/routines/overview");
    const triggers = await app.request("/v1/admin/routines/triggers");
    const bad = await app.request(
      "/v1/admin/routines/runs?start=2026-08-10T00:00:00.000Z&end=2026-07-10T00:00:00.000Z",
    );

    expect(schedules.status).toBe(200);
    expect(await schedules.json()).toMatchObject({ slug: "schedules" });
    expect(overview.status).toBe(200);
    expect(await overview.json()).toMatchObject({
      slug: "overview",
      counts: {
        routines: { total: 5, enabled: 3, disabled: 2 },
        shares: { total: 6, active: 3, revoked: 2 },
      },
    });
    expect(triggers.status).toBe(200);
    expect(await triggers.json()).toMatchObject({
      slug: "triggers",
      counts: {
        byKind: { manual: 1, calendarStart: 0, slackMention: 1 },
      },
    });
    expect(bad.status).toBe(400);
  });

  it("returns user, team, and billing-reconciliation admin records", async () => {
    const billing: BillingRepository = {
      get: vi.fn().mockResolvedValue({
        status: "healthy",
        creditBand: "healthy",
        isBlocked: false,
      }),
      summarize: vi
        .fn()
        .mockResolvedValue([
          { category: "model", quantity: 12, occurredAt: new Date() },
        ]),
    } as unknown as BillingRepository;
    const app = buildAdminApp({
      sql: mockSql(),
      operations: baseOperations,
      billing,
      harnessReady: false,
      workerEnabled: true,
    });

    const agentHealth = await app.request(
      `/v1/admin/agent-health/${routineOwnerId}`,
    );
    const users = await app.request(`/v1/admin/users/${ownerId}`);
    const teams = await app.request(`/v1/admin/teams/${squareId}`);
    const notFound = await app.request(`/v1/admin/teams/${routineOwnerId}`);
    const reconciliation = await app.request(
      `/v1/admin/billing-reconciliation/${otherUserId}`,
    );
    const empty = await app.request(
      "/v1/admin/billing-reconciliation/not-a-uuid",
    );

    expect(agentHealth.status).toBe(200);
    expect(await agentHealth.json()).toMatchObject({
      user: { id: ownerId, email: "owner@example.test" },
      readiness: { harness: false, worker: true },
      summary: operationsSummary(),
    });
    expect(users.status).toBe(200);
    const usersJson = await users.json();
    expect(usersJson).toMatchObject({
      user: { id: ownerId, firstName: "Town" },
      resources: { activeAgents: 2, openTasks: 4 },
    });
    expect(
      usersJson.accounts.some(
        (account) =>
          account.provider === "google" && account.credentialPresent === true,
      ),
    ).toBe(true);
    expect(teams.status).toBe(200);
    expect(await teams.json()).toMatchObject({
      square: { id: squareId, name: "Demo Square" },
      owner: { email: "owner@example.test" },
      policy: { defaultMode: "strict", revision: 9 },
    });
    expect(notFound.status).toBe(404);
    expect(reconciliation.status).toBe(200);
    expect(await reconciliation.json()).toMatchObject({
      status: "configured",
      reconciliation: { externalProvider: "not_configured", discrepancy: null },
      user: { id: otherUserId, status: "active" },
    });
    expect(empty.status).toBe(400);
  });
});
