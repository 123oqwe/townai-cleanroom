"use client";

import { useState } from "react";
import useSWR from "swr";

import { TownApiError, type AdminOverview } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { LoadingState } from "@/components/states";

const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? "").split(",").filter(Boolean);

function useAdminGate(userEmail: string | null): boolean {
  if (ADMIN_EMAILS.length === 0) return true;
  if (userEmail === null) return false;
  return ADMIN_EMAILS.includes(userEmail);
}

export default function AdminPage() {
  const client = useApiClient();
  const { data: overview, error, isLoading } = useSWR<AdminOverview, TownApiError>(
    ["admin-overview"],
    () => client.admin.overview(),
  );

  const [slug, setSlug] = useState("");
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);

  const isAdmin = useAdminGate(null);

  if (!isAdmin) {
    return (
      <section className="mx-auto max-w-3xl">
        <div className="rounded-lg border border-dashed p-10 text-center" style={{ borderColor: "var(--danger)" }}>
          <p className="font-medium" style={{ color: "var(--danger)" }}>403 - Admin access required</p>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>You do not have permission to view this page.</p>
        </div>
      </section>
    );
  }

  async function loadReport() {
    if (slug.trim() === "") return;
    setLoadingReport(true);
    try {
      const r = await client.admin.reports(slug.trim());
      setReport(r.data);
    } catch {
      setReport(null);
    } finally {
      setLoadingReport(false);
    }
  }

  return (
    <section className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-xl font-semibold tracking-tight">Admin</h1>

      {isLoading ? (
        <LoadingState label="Loading admin overview..." />
      ) : error !== undefined ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">{error.message}</p>
      ) : overview ? (
        <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg border p-3" style={{ background: "var(--panel)", borderColor: "var(--panel-border)" }}>
            <p className="text-xs" style={{ color: "var(--muted)" }}>Users</p>
            <p className="text-lg font-semibold">{overview.users}</p>
          </div>
          <div className="rounded-lg border p-3" style={{ background: "var(--panel)", borderColor: "var(--panel-border)" }}>
            <p className="text-xs" style={{ color: "var(--muted)" }}>Active Sessions</p>
            <p className="text-lg font-semibold">{overview.activeSessions}</p>
          </div>
          <div className="rounded-lg border p-3" style={{ background: "var(--panel)", borderColor: "var(--panel-border)" }}>
            <p className="text-xs" style={{ color: "var(--muted)" }}>Routines</p>
            <p className="text-lg font-semibold">{overview.routines}</p>
          </div>
          <div className="rounded-lg border p-3" style={{ background: "var(--panel)", borderColor: "var(--panel-border)" }}>
            <p className="text-xs" style={{ color: "var(--muted)" }}>Squares</p>
            <p className="text-lg font-semibold">{overview.squares}</p>
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border p-4" style={{ background: "var(--panel)", borderColor: "var(--panel-border)" }}>
        <h2 className="mb-3 text-sm font-medium">Reports</h2>
        <div className="flex gap-2">
          <input type="text" placeholder="Report slug (e.g. weekly)" value={slug} onChange={(e) => setSlug(e.target.value)} className="flex-1 rounded-md border p-2 text-sm" style={{ borderColor: "var(--panel-border)", background: "var(--background)" }} />
          <button type="button" onClick={loadReport} disabled={loadingReport} className="rounded-md px-3 py-2 text-sm font-medium transition-opacity disabled:opacity-60" style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}>
            {loadingReport ? "..." : "Load"}
          </button>
        </div>
        {report !== null && (
          <pre className="mt-3 overflow-auto rounded-md p-2 text-xs" style={{ background: "var(--background)" }}>
            {JSON.stringify(report, null, 2)}
          </pre>
        )}
      </div>
    </section>
  );
}
