import type { Sql } from "postgres";
import type { Context, Hono } from "hono";
import { z } from "zod";

import type { OperationsRepository } from "@town/operations";
import { asId } from "@town/contracts";
import type { BillingRepository } from "@town/billing";
import type { AuthVariables } from "./auth.js";

export interface AdminDependencies {
  sql: Sql;
  operations: OperationsRepository;
  harnessReady: boolean;
  workerEnabled: boolean;
  googleOAuthReady: boolean;
  billing?: BillingRepository;
}

const userIdSchema = z.uuidv7();
const reportSlugs = [
  "overview",
  "runtime",
  "delivery",
  "safety",
  "teams",
  "content",
  "billing",
] as const;
type ReportSlug = (typeof reportSlugs)[number];
const reportSlugSet = new Set<ReportSlug>(reportSlugs);
const periodQuerySchema = z
  .object({
    start: z.iso.datetime().optional(),
    end: z.iso.datetime().optional(),
  })
  .strict();

function resolvePeriod(query: Record<string, string | undefined>) {
  const value = periodQuerySchema.parse(query);
  const end = value.end === undefined ? new Date() : new Date(value.end);
  const start =
    value.start === undefined
      ? new Date(end.getTime() - 30 * 24 * 60 * 60 * 1_000)
      : new Date(value.start);
  if (
    start >= end ||
    end.getTime() - start.getTime() > 366 * 24 * 60 * 60 * 1_000
  )
    throw new z.ZodError([
      {
        code: "custom",
        path: ["period"],
        message: "Billing period must be positive and at most one year.",
      },
    ]);
  return { start, end };
}

function reportNotFound(context: Context<{ Variables: AuthVariables }>) {
  return context.json({ code: "REPORT_NOT_FOUND" }, 404);
}

function reportReadiness(dependencies: AdminDependencies) {
  return {
    api: true,
    harness: dependencies.harnessReady,
    worker: dependencies.workerEnabled,
    googleOAuth: dependencies.googleOAuthReady,
  };
}

async function collectOverviewReport(dependencies: AdminDependencies) {
  const countsRow = await dependencies.sql<
    {
      users_total: number;
      users_active: number;
      connected_accounts_active: number;
      active_sessions: number;
      queued_runs: number;
      failed_runs: number;
      pending_approvals: number;
      queued_deliveries: number;
      failed_deliveries: number;
      active_squares: number;
      failed_audit_events_24h: number;
    }[]
  >`
      select
        (select count(*)::int from users) as users_total,
        (select count(*)::int from users where status='active') as users_active,
        (select count(*)::int from connected_accounts where is_active=true) as connected_accounts_active,
        (select count(*)::int from runtime_sessions where state in ('running','waiting_approval','waiting_user_input')) as active_sessions,
        (select count(*)::int from session_runs where state='queued') as queued_runs,
        (select count(*)::int from session_runs where state='failed') as failed_runs,
        (select count(*)::int from approval_requests where state='pending') as pending_approvals,
        (select count(*)::int from notification_deliveries where status in ('queued','attempting')) as queued_deliveries,
        (select count(*)::int from notification_deliveries where status='failed') as failed_deliveries,
        (select count(*)::int from squares where status='active') as active_squares,
        (select count(*)::int from operation_audit_events where outcome='failed' and created_at >= now() - interval '24 hours') as failed_audit_events_24h
  `;
  const row = countsRow[0];
  return {
    generatedAt: new Date(),
    readiness: reportReadiness(dependencies),
    counts: {
      users: { total: row?.users_total ?? 0, active: row?.users_active ?? 0 },
      connectedAccounts: row?.connected_accounts_active ?? 0,
      activeSessions: row?.active_sessions ?? 0,
      queuedRuns: row?.queued_runs ?? 0,
      failedRuns: row?.failed_runs ?? 0,
      pendingApprovals: row?.pending_approvals ?? 0,
      queuedDeliveries: row?.queued_deliveries ?? 0,
      failedDeliveries: row?.failed_deliveries ?? 0,
      activeSquares: row?.active_squares ?? 0,
      failedAuditEvents24h: row?.failed_audit_events_24h ?? 0,
    },
  };
}

function parseReportSlug(candidate: string | undefined): ReportSlug | null {
  return candidate !== undefined && reportSlugSet.has(candidate as ReportSlug)
    ? (candidate as ReportSlug)
    : null;
}

/**
 * Clean-room administrative health: it reports safe operational counters and
 * readiness, never prompts, credentials, provider payloads, or private Town
 * implementation details.
 */
export function registerAdminRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: AdminDependencies,
): void {
  app.get("/v1/admin/overview", async (context) => {
    return context.json(await collectOverviewReport(dependencies));
  });
  app.get("/v1/admin/reports/:slug", async (context) => {
    const slug = parseReportSlug(context.req.param("slug"));
    if (slug === null) return reportNotFound(context);
    if (slug === "overview")
      return context.json({
        slug,
        ...(await collectOverviewReport(dependencies)),
      });
    const period = resolvePeriod(context.req.query());
    switch (slug) {
      case "runtime": {
        const [row] = await dependencies.sql<
          {
            sessions_running: number;
            sessions_waiting_approval: number;
            sessions_waiting_input: number;
            sessions_failed: number;
            sessions_cancelled: number;
            runs_queued: number;
            runs_running: number;
            runs_failed: number;
            runs_cancelled: number;
            runs_succeeded: number;
            runs_waiting_approval: number;
            runs_waiting_input: number;
          }[]
        >`
          select
            (select count(*)::int from runtime_sessions where state='running') as sessions_running,
            (select count(*)::int from runtime_sessions where state='waiting_approval') as sessions_waiting_approval,
            (select count(*)::int from runtime_sessions where state='waiting_user_input') as sessions_waiting_input,
            (select count(*)::int from runtime_sessions where state='failed') as sessions_failed,
            (select count(*)::int from runtime_sessions where state='cancelled') as sessions_cancelled,
            (select count(*)::int from session_runs where state='queued') as runs_queued,
            (select count(*)::int from session_runs where state='running') as runs_running,
            (select count(*)::int from session_runs where state='failed') as runs_failed,
            (select count(*)::int from session_runs where state='cancelled') as runs_cancelled,
            (select count(*)::int from session_runs where state='succeeded') as runs_succeeded,
            (select count(*)::int from session_runs where state='waiting_approval') as runs_waiting_approval,
            (select count(*)::int from session_runs where state='waiting_user_input') as runs_waiting_input
        `;
        return context.json({
          slug,
          generatedAt: new Date(),
          readiness: reportReadiness(dependencies),
          period,
          totals: {
            sessions: {
              running: row?.sessions_running ?? 0,
              waitingForApproval: row?.sessions_waiting_approval ?? 0,
              waitingForInput: row?.sessions_waiting_input ?? 0,
              failed: row?.sessions_failed ?? 0,
              cancelled: row?.sessions_cancelled ?? 0,
            },
            runs: {
              queued: row?.runs_queued ?? 0,
              running: row?.runs_running ?? 0,
              waitingApproval: row?.runs_waiting_approval ?? 0,
              waitingInput: row?.runs_waiting_input ?? 0,
              failed: row?.runs_failed ?? 0,
              cancelled: row?.runs_cancelled ?? 0,
              succeeded: row?.runs_succeeded ?? 0,
            },
          },
        });
      }
      case "delivery": {
        const [row] = await dependencies.sql<
          {
            deliveries_active: number;
            deliveries_success: number;
            deliveries_failed: number;
            deliveries_replayed: number;
            events_queued: number;
            events_attempting: number;
            events_failed_24h: number;
            events_succeeded_24h: number;
          }[]
        >`
          select
            (select count(*)::int from notification_deliveries where status in ('queued','attempting')) as deliveries_active,
            (select count(*)::int from notification_deliveries where status='succeeded') as deliveries_success,
            (select count(*)::int from notification_deliveries where status='failed') as deliveries_failed,
            (select count(*)::int from notification_deliveries where replay_of_delivery_id is not null) as deliveries_replayed,
            (select count(*)::int from notification_deliveries where status='queued') as events_queued,
            (select count(*)::int from notification_deliveries where status='attempting') as events_attempting,
            (select count(*)::int from notification_deliveries where status='failed' and created_at >= ${period.start} and created_at < ${period.end}) as events_failed_24h,
            (select count(*)::int from notification_deliveries where status='succeeded' and created_at >= ${period.start} and created_at < ${period.end}) as events_succeeded_24h
        `;
        return context.json({
          slug,
          generatedAt: new Date(),
          period,
          readiness: reportReadiness(dependencies),
          totals: {
            active: row?.deliveries_active ?? 0,
            success: row?.deliveries_success ?? 0,
            failed: row?.deliveries_failed ?? 0,
            replayed: row?.deliveries_replayed ?? 0,
            queued: row?.events_queued ?? 0,
            attempting: row?.events_attempting ?? 0,
            failedPeriod: row?.events_failed_24h ?? 0,
            succeededPeriod: row?.events_succeeded_24h ?? 0,
          },
        });
      }
      case "safety": {
        const [row] = await dependencies.sql<
          {
            pending_approvals: number;
            approved_last_24h: number;
            rejected_last_24h: number;
            expired_last_24h: number;
            active_sessions: number;
            tool_calls_pending: number;
            tool_calls_running: number;
          }[]
        >`
          select
            (select count(*)::int from approval_requests where state='pending') as pending_approvals,
            (select count(*)::int from approval_requests where state='approved' and updated_at >= ${period.start} and updated_at < ${period.end}) as approved_last_24h,
            (select count(*)::int from approval_requests where state='rejected' and updated_at >= ${period.start} and updated_at < ${period.end}) as rejected_last_24h,
            (select count(*)::int from approval_requests where state='expired' and updated_at >= ${period.start} and updated_at < ${period.end}) as expired_last_24h,
            (select count(*)::int from runtime_sessions where state in ('running','waiting_approval','waiting_user_input')) as active_sessions,
            (select count(*)::int from tool_calls where status='proposed') as tool_calls_pending,
            (select count(*)::int from tool_calls where status='executing') as tool_calls_running
        `;
        return context.json({
          slug,
          generatedAt: new Date(),
          period,
          counts: {
            approvals: {
              pending: row?.pending_approvals ?? 0,
              approvedPeriod: row?.approved_last_24h ?? 0,
              rejectedPeriod: row?.rejected_last_24h ?? 0,
              expiredPeriod: row?.expired_last_24h ?? 0,
            },
            activeSessions: row?.active_sessions ?? 0,
            tools: {
              pending: row?.tool_calls_pending ?? 0,
              executing: row?.tool_calls_running ?? 0,
            },
          },
        });
      }
      case "teams": {
        const [row] = await dependencies.sql<
          {
            teams_total: number;
            teams_active: number;
            members_active: number;
            members_invited: number;
            members_suspended: number;
          }[]
        >`
          select
            (select count(*)::int from squares) as teams_total,
            (select count(*)::int from squares where status='active') as teams_active,
            (select count(*)::int from square_memberships where status='active') as members_active,
            (select count(*)::int from square_memberships where status='invited') as members_invited,
            (select count(*)::int from square_memberships where status='suspended') as members_suspended
        `;
        return context.json({
          slug,
          generatedAt: new Date(),
          readiness: reportReadiness(dependencies),
          counts: {
            teams: {
              total: row?.teams_total ?? 0,
              active: row?.teams_active ?? 0,
            },
            memberships: {
              active: row?.members_active ?? 0,
              invited: row?.members_invited ?? 0,
              suspended: row?.members_suspended ?? 0,
            },
          },
        });
      }
      case "content": {
        const [row] = await dependencies.sql<
          {
            total_items: number;
            active_items: number;
            archived_items: number;
            deleted_items: number;
            session_items: number;
            shared_tokens: number;
            active_shares: number;
          }[]
        >`
          select
            (select count(*)::int from content_items) as total_items,
            (select count(*)::int from content_items where status='active') as active_items,
            (select count(*)::int from content_items where status='archived') as archived_items,
            (select count(*)::int from content_items where status='deleted') as deleted_items,
            (select count(*)::int from content_items where kind='session') as session_items,
            (select count(*)::int from content_share_tokens) as shared_tokens,
            (select count(*)::int from content_share_tokens where revoked_at is null and (expires_at is null or expires_at > now())) as active_shares
        `;
        return context.json({
          slug,
          generatedAt: new Date(),
          period,
          counts: {
            items: {
              total: row?.total_items ?? 0,
              active: row?.active_items ?? 0,
              archived: row?.archived_items ?? 0,
              deleted: row?.deleted_items ?? 0,
              sessionItems: row?.session_items ?? 0,
            },
            shares: {
              total: row?.shared_tokens ?? 0,
              active: row?.active_shares ?? 0,
            },
          },
        });
      }
      case "billing": {
        const [row] = await dependencies.sql<
          {
            users_with_billing: number;
            blocked_users: number;
            warning_users: number;
            healthy_users: number;
            usage_entries: number;
          }[]
        >`
          select
            (select count(*)::int from billing_accounts) as users_with_billing,
            (select count(*)::int from billing_accounts where is_blocked=true) as blocked_users,
            (select count(*)::int from billing_accounts where credit_band='warning') as warning_users,
            (select count(*)::int from billing_accounts where credit_band='healthy') as healthy_users,
            (select count(*)::int from usage_ledger) as usage_entries
        `;
        const [row24h] = await dependencies.sql<
          { usage_events_24h: number; model_events_24h: number }[]
        >`
          select
            (select coalesce(sum(quantity)::int, 0) from usage_ledger where occurred_at >= ${period.start} and occurred_at < ${period.end}) as usage_events_24h,
            (select coalesce(sum(quantity)::int, 0) from usage_ledger where category='model' and occurred_at >= ${period.start} and occurred_at < ${period.end}) as model_events_24h
        `;
        return context.json({
          slug,
          generatedAt: new Date(),
          period,
          configured: dependencies.billing !== undefined,
          counts: {
            accounts: {
              total: row?.users_with_billing ?? 0,
              blocked: row?.blocked_users ?? 0,
              warning: row?.warning_users ?? 0,
              healthy: row?.healthy_users ?? 0,
            },
            usage: {
              events: row?.usage_entries ?? 0,
              eventsInPeriod: row24h?.usage_events_24h ?? 0,
              modelEventsInPeriod: row24h?.model_events_24h ?? 0,
            },
          },
          reconciliation: {
            externalProvider:
              dependencies.billing === undefined
                ? "not_configured"
                : "not_available",
            discrepancy: null,
          },
        });
      }
      default:
        return reportNotFound(context);
    }
  });
  app.get("/v1/admin/agent-health/:userId", async (context) => {
    const userId = userIdSchema.parse(context.req.param("userId"));
    const [user] = await dependencies.sql<
      { id: string; email: string; status: string; created_at: Date }[]
    >`
      select id,email,status,created_at
      from users
      where id=${userId}
    `;
    if (!user) return context.json({ code: "USER_NOT_FOUND" }, 404);
    const summary = await dependencies.operations.summary(asId<"user">(userId));
    return context.json({
      user: {
        id: user.id,
        email: user.email,
        status: user.status,
        createdAt: user.created_at,
      },
      readiness: {
        api: true,
        harness: dependencies.harnessReady,
        worker: dependencies.workerEnabled,
        googleOAuth: dependencies.googleOAuthReady,
      },
      summary,
    });
  });
  app.get("/v1/admin/users/:userId", async (context) => {
    const userId = userIdSchema.parse(context.req.param("userId"));
    const [user] = await dependencies.sql<
      {
        id: string;
        email: string;
        first_name: string | null;
        last_name: string | null;
        timezone: string;
        status: string;
        created_at: Date;
        updated_at: Date;
        has_profile: boolean;
        agent_count: number;
        thread_count: number;
        task_count: number;
      }[]
    >`
      select u.id,u.email,u.first_name,u.last_name,u.timezone,u.status,
        u.created_at,u.updated_at,
        exists(select 1 from profiles p where p.owner_id=u.id) as has_profile,
        (select count(*)::int from agents a where a.owner_id=u.id and a.status='active') as agent_count,
        (select count(*)::int from threads t where t.owner_id=u.id and t.status='active') as thread_count,
        (select count(*)::int from tasks t where t.owner_id=u.id and t.deleted_at is null) as task_count
      from users u
      where u.id=${userId}
    `;
    if (!user) return context.json({ code: "USER_NOT_FOUND" }, 404);
    const accounts = await dependencies.sql<
      {
        id: string;
        provider: string;
        email: string;
        is_active: boolean;
        credential_present: boolean;
      }[]
    >`
      select id,provider,email::text,is_active,(credential_id is not null) as credential_present
      from connected_accounts
      where owner_id=${userId}
      order by created_at desc,id desc
    `;
    return context.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        timezone: user.timezone,
        status: user.status,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      },
      resources: {
        hasProfile: user.has_profile,
        activeAgents: user.agent_count,
        activeThreads: user.thread_count,
        openTasks: user.task_count,
      },
      accounts: accounts.map((account) => ({
        id: account.id,
        provider: account.provider,
        email: account.email,
        isActive: account.is_active,
        credentialPresent: account.credential_present,
      })),
    });
  });
  app.get("/v1/admin/teams/:squareId", async (context) => {
    const squareId = userIdSchema.parse(context.req.param("squareId"));
    const [square] = await dependencies.sql<
      {
        id: string;
        owner_id: string;
        owner_email: string;
        name: string;
        slug: string;
        description: string;
        status: string;
        created_at: Date;
        updated_at: Date;
        active_members: number;
        invited_members: number;
        suspended_members: number;
        policy_mode: string | null;
        policy_revision: number | null;
      }[]
    >`
      select s.id,s.owner_id,u.email as owner_email,s.name,s.slug,s.description,
        s.status,s.created_at,s.updated_at,
        (select count(*)::int from square_memberships m where m.square_id=s.id and m.status='active') as active_members,
        (select count(*)::int from square_memberships m where m.square_id=s.id and m.status='invited') as invited_members,
        (select count(*)::int from square_memberships m where m.square_id=s.id and m.status='suspended') as suspended_members,
        p.default_mode as policy_mode,p.revision as policy_revision
      from squares s
      join users u on u.id=s.owner_id
      left join square_policies p on p.square_id=s.id and p.owner_id=s.owner_id
      where s.id=${squareId}
    `;
    if (!square) return context.json({ code: "SQUARE_NOT_FOUND" }, 404);
    return context.json({
      square: {
        id: square.id,
        name: square.name,
        slug: square.slug,
        description: square.description,
        status: square.status,
        createdAt: square.created_at,
        updatedAt: square.updated_at,
      },
      owner: { id: square.owner_id, email: square.owner_email },
      membershipCounts: {
        active: square.active_members,
        invited: square.invited_members,
        suspended: square.suspended_members,
      },
      policy:
        square.policy_mode === null
          ? null
          : {
              defaultMode: square.policy_mode,
              revision: square.policy_revision,
            },
    });
  });
  app.get("/v1/admin/billing-reconciliation/:userId", async (context) => {
    const userId = userIdSchema.parse(context.req.param("userId"));
    const [user] = await dependencies.sql<
      { id: string; email: string; status: string }[]
    >`select id,email,status from users where id=${userId}`;
    if (!user) return context.json({ code: "USER_NOT_FOUND" }, 404);
    const period = resolvePeriod(context.req.query());
    const billing = dependencies.billing
      ? await dependencies.billing.get(asId<"user">(userId))
      : null;
    const usage = dependencies.billing
      ? await dependencies.billing.summarize(
          asId<"user">(userId),
          period.start,
          period.end,
        )
      : [];
    return context.json({
      user: { id: user.id, email: user.email, status: user.status },
      period,
      status:
        billing === null
          ? ("not_configured" as const)
          : ("configured" as const),
      billing,
      usage,
      reconciliation: {
        externalProvider: "not_configured" as const,
        discrepancy: null,
      },
    });
  });
}
