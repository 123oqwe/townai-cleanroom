import type { Sql } from "postgres";
import type { Hono } from "hono";
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
    const [row] = await dependencies.sql<
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
    return context.json({
      generatedAt: new Date(),
      readiness: {
        api: true,
        harness: dependencies.harnessReady,
        worker: dependencies.workerEnabled,
        googleOAuth: dependencies.googleOAuthReady,
      },
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
    });
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
