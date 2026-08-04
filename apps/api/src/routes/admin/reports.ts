import type { AdminDependencies } from "./types.js";

export function reportReadiness(dependencies: AdminDependencies) {
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

export async function collectOverviewReport(dependencies: AdminDependencies) {
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
