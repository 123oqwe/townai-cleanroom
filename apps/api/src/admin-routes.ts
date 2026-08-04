import type { Sql } from "postgres";
import type { Context, Hono } from "hono";
import { z } from "zod";

import type { OperationsRepository } from "@town/operations";
import { asId } from "@town/contracts";
import type { BillingRepository } from "@town/billing";
import type { AuthVariables } from "./auth.js";

export type ContentStorageReadiness = boolean | "read-only";

export interface AdminDependencies {
  sql: Sql;
  operations: OperationsRepository;
  harnessReady: boolean;
  workerEnabled: boolean;
  googleOAuthReady: boolean;
  microsoftOAuthReady: boolean;
  slackEvents: boolean;
  telegramEvents: boolean;
  whatsappEvents: boolean;
  twilioVoice: boolean;
  vapiVoice: boolean;
  voiceSynthesis: boolean;
  contentStorage: ContentStorageReadiness;
  workspaceTools: boolean;
  codeRunner: boolean;
  e2bSandbox: boolean;
  pipedreamCatalog: boolean;
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

const routineReportSlugs = [
  "overview",
  "schedules",
  "triggers",
  "runs",
  "webhooks",
  "shares",
] as const;
type RoutineReportSlug = (typeof routineReportSlugs)[number];
const routineReportSlugSet = new Set<RoutineReportSlug>(routineReportSlugs);
const periodQuerySchema = z
  .object({
    start: z.iso.datetime().optional(),
    end: z.iso.datetime().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const end = value.end === undefined ? new Date() : new Date(value.end);
    const start =
      value.start === undefined
        ? new Date(end.getTime() - 30 * 24 * 60 * 60 * 1_000)
        : new Date(value.start);
    if (
      start >= end ||
      end.getTime() - start.getTime() > 366 * 24 * 60 * 60 * 1_000
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["period"],
        message: "Billing period must be positive and at most one year.",
      });
    }
  });

function resolvePeriod(query: Record<string, string | undefined>) {
  const value = periodQuerySchema.parse(query);
  const end = value.end === undefined ? new Date() : new Date(value.end);
  const start =
    value.start === undefined
      ? new Date(end.getTime() - 30 * 24 * 60 * 60 * 1_000)
      : new Date(value.start);
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
    microsoftOAuth: dependencies.microsoftOAuthReady,
    slackEvents: dependencies.slackEvents,
    telegramEvents: dependencies.telegramEvents,
    whatsappEvents: dependencies.whatsappEvents,
    twilioVoice: dependencies.twilioVoice,
    vapiVoice: dependencies.vapiVoice,
    voiceSynthesis: dependencies.voiceSynthesis,
    contentStorage: dependencies.contentStorage,
    workspaceTools: dependencies.workspaceTools,
    codeRunner: dependencies.codeRunner,
    e2bSandbox: dependencies.e2bSandbox,
    pipedreamCatalog: dependencies.pipedreamCatalog,
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

function parseRoutineReportSlug(
  candidate: string | undefined,
): RoutineReportSlug | null {
  return candidate !== undefined &&
    routineReportSlugSet.has(candidate as RoutineReportSlug)
    ? (candidate as RoutineReportSlug)
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
  const getAdminOverview = async (
    context: Context<{ Variables: AuthVariables }>,
  ) => {
    return context.json(await collectOverviewReport(dependencies));
  };
  app.get("/v1/admin/overview", getAdminOverview);
  app.get("/admin/overview", getAdminOverview);
  const getAdminReport = async (
    context: Context<{ Variables: AuthVariables }>,
  ) => {
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
  };
  app.get("/v1/admin/reports/:slug", getAdminReport);
  app.get("/admin/reports/:slug", getAdminReport);
  const getRoutineReport = async (
    context: Context<{ Variables: AuthVariables }>,
  ) => {
    const slug = parseRoutineReportSlug(context.req.param("slug"));
    if (slug === null) return reportNotFound(context);
    const query = context.req.query();
    const period = resolvePeriod(query);

    switch (slug) {
      case "overview": {
        const [row] = await dependencies.sql<
          {
            routines_total: number;
            routines_enabled: number;
            routines_disabled: number;
            triggers_total: number;
            triggers_enabled: number;
            sync_queued: number;
            sync_running: number;
            sync_succeeded: number;
            sync_failed: number;
            sync_blocked: number;
            webhooks_total: number;
            webhooks_enabled: number;
            shares_total: number;
            shares_active: number;
            shares_revoked: number;
          }[]
        >`
          select
            (select count(*)::int from routine_schedules) as routines_total,
            (select count(*)::int from routine_schedules where enabled=true) as routines_enabled,
            (select count(*)::int from routine_schedules where enabled=false) as routines_disabled,
            (select count(*)::int from routine_triggers) as triggers_total,
            (select count(*)::int from routine_triggers where enabled=true) as triggers_enabled,
            (select count(*)::int from integration_sync_runs where status='queued') as sync_queued,
            (select count(*)::int from integration_sync_runs where status='running') as sync_running,
            (select count(*)::int from integration_sync_runs where status='succeeded') as sync_succeeded,
            (select count(*)::int from integration_sync_runs where status='failed') as sync_failed,
            (select count(*)::int from integration_sync_runs where status='blocked') as sync_blocked,
            (select count(*)::int from routine_webhooks) as webhooks_total,
            (select count(*)::int from routine_webhooks where enabled=true) as webhooks_enabled,
            (select count(*)::int from routine_share_grants) as shares_total,
            (select count(*)::int from routine_share_grants where revoked_at is null and (expires_at is null or expires_at > now())) as shares_active,
            (select count(*)::int from routine_share_grants where revoked_at is not null) as shares_revoked
        `;
        return context.json({
          slug,
          generatedAt: new Date(),
          period,
          readiness: reportReadiness(dependencies),
          counts: {
            routines: {
              total: row?.routines_total ?? 0,
              enabled: row?.routines_enabled ?? 0,
              disabled: row?.routines_disabled ?? 0,
            },
            triggers: {
              total: row?.triggers_total ?? 0,
              enabled: row?.triggers_enabled ?? 0,
            },
            runs: {
              queued: row?.sync_queued ?? 0,
              running: row?.sync_running ?? 0,
              succeeded: row?.sync_succeeded ?? 0,
              failed: row?.sync_failed ?? 0,
              blocked: row?.sync_blocked ?? 0,
            },
            webhooks: {
              total: row?.webhooks_total ?? 0,
              enabled: row?.webhooks_enabled ?? 0,
            },
            shares: {
              total: row?.shares_total ?? 0,
              active: row?.shares_active ?? 0,
              revoked: row?.shares_revoked ?? 0,
            },
          },
        });
      }
      case "schedules": {
        const [row] = await dependencies.sql<
          {
            routines_total: number;
            routines_enabled: number;
            routines_disabled: number;
            routines_created_period: number;
            routines_updated_period: number;
            routines_overdue: number;
            routines_due_24h: number;
            routines_stale_last_run: number;
          }[]
        >`
          select
            (select count(*)::int from routine_schedules) as routines_total,
            (select count(*)::int from routine_schedules where enabled=true) as routines_enabled,
            (select count(*)::int from routine_schedules where enabled=false) as routines_disabled,
            (select count(*)::int from routine_schedules where created_at >= ${period.start} and created_at < ${period.end}) as routines_created_period,
            (select count(*)::int from routine_schedules where updated_at >= ${period.start} and updated_at < ${period.end}) as routines_updated_period,
            (select count(*)::int from routine_schedules where next_run_at < now()) as routines_overdue,
            (select count(*)::int from routine_schedules where next_run_at >= now() and next_run_at < now() + interval '24 hours') as routines_due_24h,
            (select count(*)::int from routine_schedules where last_run_at is not null and last_run_at < now() - interval '30 days') as routines_stale_last_run
        `;
        return context.json({
          slug,
          generatedAt: new Date(),
          period,
          counts: {
            routines: {
              total: row?.routines_total ?? 0,
              enabled: row?.routines_enabled ?? 0,
              disabled: row?.routines_disabled ?? 0,
              overdue: row?.routines_overdue ?? 0,
              dueIn24h: row?.routines_due_24h ?? 0,
            },
            lifecycle: {
              createdInPeriod: row?.routines_created_period ?? 0,
              updatedInPeriod: row?.routines_updated_period ?? 0,
              staleLastRun: row?.routines_stale_last_run ?? 0,
            },
          },
        });
      }
      case "triggers": {
        const [row] = await dependencies.sql<
          {
            triggers_total: number;
            triggers_enabled: number;
            triggers_disabled: number;
            triggers_created_period: number;
            manual: number;
            schedule: number;
            incoming_email: number;
            outgoing_email: number;
            email_to_assistant: number;
            calendar_start: number;
            calendar_end: number;
            calendar_rsvp: number;
            calendar_changed: number;
            voice_transcribed: number;
            slack_mention: number;
            webhook: number;
          }[]
        >`
          select
            (select count(*)::int from routine_triggers) as triggers_total,
            (select count(*)::int from routine_triggers where enabled=true) as triggers_enabled,
            (select count(*)::int from routine_triggers where enabled=false) as triggers_disabled,
            (select count(*)::int from routine_triggers where created_at >= ${period.start} and created_at < ${period.end}) as triggers_created_period,
            (select count(*)::int from routine_triggers where kind='manual') as manual,
            (select count(*)::int from routine_triggers where kind='schedule') as schedule,
            (select count(*)::int from routine_triggers where kind='incoming_email') as incoming_email,
            (select count(*)::int from routine_triggers where kind='outgoing_email') as outgoing_email,
            (select count(*)::int from routine_triggers where kind='email_to_assistant') as email_to_assistant,
            (select count(*)::int from routine_triggers where kind='calendar_start') as calendar_start,
            (select count(*)::int from routine_triggers where kind='calendar_end') as calendar_end,
            (select count(*)::int from routine_triggers where kind='calendar_rsvp') as calendar_rsvp,
            (select count(*)::int from routine_triggers where kind='calendar_changed') as calendar_changed,
            (select count(*)::int from routine_triggers where kind='voice_transcribed') as voice_transcribed,
            (select count(*)::int from routine_triggers where kind='slack_mention') as slack_mention,
            (select count(*)::int from routine_triggers where kind='webhook') as webhook
        `;
        return context.json({
          slug,
          generatedAt: new Date(),
          period,
          counts: {
            total: row?.triggers_total ?? 0,
            enabled: row?.triggers_enabled ?? 0,
            disabled: row?.triggers_disabled ?? 0,
            createdInPeriod: row?.triggers_created_period ?? 0,
            byKind: {
              manual: row?.manual ?? 0,
              schedule: row?.schedule ?? 0,
              incomingEmail: row?.incoming_email ?? 0,
              outgoingEmail: row?.outgoing_email ?? 0,
              emailToAssistant: row?.email_to_assistant ?? 0,
              calendarStart: row?.calendar_start ?? 0,
              calendarEnd: row?.calendar_end ?? 0,
              calendarRsvp: row?.calendar_rsvp ?? 0,
              calendarChanged: row?.calendar_changed ?? 0,
              voiceTranscribed: row?.voice_transcribed ?? 0,
              slackMention: row?.slack_mention ?? 0,
              webhook: row?.webhook ?? 0,
            },
          },
        });
      }
      case "runs": {
        const [row] = await dependencies.sql<
          {
            runs_total: number;
            runs_queued: number;
            runs_running: number;
            runs_succeeded: number;
            runs_failed: number;
            runs_blocked: number;
            runs_google: number;
            runs_calendar: number;
            runs_webhook: number;
            runs_voice_transcribed: number;
            runs_failed_period: number;
            runs_succeeded_period: number;
            runtimeRunsLinked: number;
            runtimeRunsLinkedPeriod: number;
          }[]
        >`
          select
            (select count(*)::int from integration_sync_runs) as runs_total,
            (select count(*)::int from integration_sync_runs where status='queued') as runs_queued,
            (select count(*)::int from integration_sync_runs where status='running') as runs_running,
            (select count(*)::int from integration_sync_runs where status='succeeded') as runs_succeeded,
            (select count(*)::int from integration_sync_runs where status='failed') as runs_failed,
            (select count(*)::int from integration_sync_runs where status='blocked') as runs_blocked,
            (select count(*)::int from integration_sync_runs where provider='google') as runs_google,
            (select count(*)::int from integration_sync_runs where provider='calendar') as runs_calendar,
            (select count(*)::int from integration_sync_runs where trigger_type='webhook') as runs_webhook,
            (select count(*)::int from integration_sync_runs where trigger_type='voice_transcribed') as runs_voice_transcribed,
            (select count(*)::int from integration_sync_runs where status='failed' and created_at >= ${period.start} and created_at < ${period.end}) as runs_failed_period,
            (select count(*)::int from integration_sync_runs where status='succeeded' and finished_at >= ${period.start} and finished_at < ${period.end}) as runs_succeeded_period,
            (select count(*)::int from integration_sync_runs where runtime_run_id is not null) as runtimeRunsLinked,
            (select count(*)::int from integration_sync_runs where runtime_run_id is not null and created_at >= ${period.start} and created_at < ${period.end}) as runtimeRunsLinkedPeriod
        `;
        return context.json({
          slug,
          generatedAt: new Date(),
          period,
          totals: {
            all: {
              total: row?.runs_total ?? 0,
              queued: row?.runs_queued ?? 0,
              running: row?.runs_running ?? 0,
              succeeded: row?.runs_succeeded ?? 0,
              failed: row?.runs_failed ?? 0,
              blocked: row?.runs_blocked ?? 0,
            },
            byProvider: {
              google: row?.runs_google ?? 0,
              calendar: row?.runs_calendar ?? 0,
              other: 0,
            },
            byTriggerType: {
              webhook: row?.runs_webhook ?? 0,
              voiceTranscribed: row?.runs_voice_transcribed ?? 0,
            },
            runtimeLinked: {
              total: row?.runtimeRunsLinked ?? 0,
              period: row?.runtimeRunsLinkedPeriod ?? 0,
            },
            byPeriod: {
              succeeded: row?.runs_succeeded_period ?? 0,
              failed: row?.runs_failed_period ?? 0,
            },
          },
        });
      }
      case "webhooks": {
        const [row] = await dependencies.sql<
          {
            webhooks_total: number;
            webhooks_enabled: number;
            webhooks_disabled: number;
            deliveries_total: number;
            deliveries_period: number;
            deliveries_latest: number;
          }[]
        >`
          select
            (select count(*)::int from routine_webhooks) as webhooks_total,
            (select count(*)::int from routine_webhooks where enabled=true) as webhooks_enabled,
            (select count(*)::int from routine_webhooks where enabled=false) as webhooks_disabled,
            (select count(*)::int from routine_webhook_deliveries) as deliveries_total,
            (select count(*)::int from routine_webhook_deliveries where created_at >= ${period.start} and created_at < ${period.end}) as deliveries_period,
            (select count(*)::int from routine_webhook_deliveries where created_at >= (now() - interval '24 hours')) as deliveries_latest
        `;
        return context.json({
          slug,
          generatedAt: new Date(),
          period,
          counts: {
            webhooks: {
              total: row?.webhooks_total ?? 0,
              enabled: row?.webhooks_enabled ?? 0,
              disabled: row?.webhooks_disabled ?? 0,
            },
            deliveries: {
              total: row?.deliveries_total ?? 0,
              inPeriod: row?.deliveries_period ?? 0,
              inLast24h: row?.deliveries_latest ?? 0,
            },
          },
        });
      }
      case "shares": {
        const [row] = await dependencies.sql<
          {
            shares_total: number;
            shares_active: number;
            shares_revoked: number;
            shares_expired: number;
            shares_created: number;
            shares_revoked_period: number;
            shares_expired_period: number;
          }[]
        >`
          select
            (select count(*)::int from routine_share_grants) as shares_total,
            (select count(*)::int from routine_share_grants where revoked_at is null and (expires_at is null or expires_at > now())) as shares_active,
            (select count(*)::int from routine_share_grants where revoked_at is not null) as shares_revoked,
            (select count(*)::int from routine_share_grants where revoked_at is null and expires_at is not null and expires_at <= now()) as shares_expired,
            (select count(*)::int from routine_share_grants where created_at >= ${period.start} and created_at < ${period.end}) as shares_created,
            (select count(*)::int from routine_share_grants where revoked_at >= ${period.start} and revoked_at < ${period.end}) as shares_revoked_period,
            (select count(*)::int from routine_share_grants where revoked_at is null and expires_at is not null and expires_at >= ${period.start} and expires_at < ${period.end}) as shares_expired_period
        `;
        return context.json({
          slug,
          generatedAt: new Date(),
          period,
          counts: {
            shares: {
              total: row?.shares_total ?? 0,
              active: row?.shares_active ?? 0,
              revoked: row?.shares_revoked ?? 0,
              expired: row?.shares_expired ?? 0,
            },
            byPeriod: {
              created: row?.shares_created ?? 0,
              revoked: row?.shares_revoked_period ?? 0,
              expired: row?.shares_expired_period ?? 0,
            },
          },
        });
      }
      default:
        return reportNotFound(context);
    }
  };
  app.get("/v1/admin/routines/:slug", getRoutineReport);
  app.get("/admin/routines/:slug", getRoutineReport);
  const getAdminAgentHealth = async (
    context: Context<{ Variables: AuthVariables }>,
  ) => {
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
      readiness: reportReadiness(dependencies),
      summary,
    });
  };
  app.get("/v1/admin/agent-health/:userId", getAdminAgentHealth);
  app.get("/admin/agent-health/:userId", getAdminAgentHealth);
  const getAdminUser = async (
    context: Context<{ Variables: AuthVariables }>,
  ) => {
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
  };
  app.get("/v1/admin/users/:userId", getAdminUser);
  app.get("/admin/users/:userId", getAdminUser);
  const getAdminTeam = async (
    context: Context<{ Variables: AuthVariables }>,
  ) => {
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
  };
  app.get("/v1/admin/teams/:squareId", getAdminTeam);
  app.get("/admin/teams/:squareId", getAdminTeam);
  const getAdminBillingReconciliation = async (
    context: Context<{ Variables: AuthVariables }>,
  ) => {
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
  };
  app.get(
    "/v1/admin/billing-reconciliation/:userId",
    getAdminBillingReconciliation,
  );
  app.get(
    "/admin/billing-reconciliation/:userId",
    getAdminBillingReconciliation,
  );
}
