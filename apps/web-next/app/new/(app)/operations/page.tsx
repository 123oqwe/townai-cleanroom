"use client";

import { useState } from "react";
import useSWR from "swr";

import { TownApiError, type AuditPage, type OperationsSummary } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";
import Link from "next/link";

export default function OperationsPage() {
  const client = useApiClient();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const { data: summaryData, error: sumError } = useSWR<OperationsSummary, TownApiError>(
    ["operations-summary"],
    () => client.operations.summary(),
  );

  const { data: auditData, error: auditError, isLoading } = useSWR<AuditPage, TownApiError>(
    ["operations-audit", cursor],
    () => client.operations.audit.list({ limit: 20, cursor }),
  );

  const auditItems = auditData?.items ?? [];
  const nextCursor = auditData?.nextCursor ?? null;
  const summary = summaryData?.summary ?? {};

  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Operations</h1>
        <Link href="/new/operations/schedule" className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-[color:var(--background)]" style={{ borderColor: "var(--panel-border)" }}>
          Schedule
        </Link>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Object.entries(summary).map(([key, value]) => (
          <div key={key} className="rounded-lg border p-3" style={{ background: "var(--panel)", borderColor: "var(--panel-border)" }}>
            <p className="text-xs" style={{ color: "var(--muted)" }}>{key}</p>
            <p className="text-lg font-semibold">{value}</p>
          </div>
        ))}
      </div>

      <h2 className="mb-3 text-sm font-medium">Audit Log</h2>
      {isLoading && cursor === undefined ? (
        <LoadingState label="Loading audit log..." />
      ) : sumError !== undefined || auditError !== undefined ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {(sumError ?? auditError)?.message}
        </p>
      ) : auditItems.length === 0 ? (
        <EmptyState title="No audit events." />
      ) : (
        <>
          <ul className="flex flex-col gap-1">
            {auditItems.map((item) => (
              <li key={item.id} className="flex items-center justify-between rounded-md border p-2 text-xs" style={{ borderColor: "var(--panel-border)" }}>
                <div>
                  <strong>{item.action}</strong>
                  <span style={{ color: "var(--muted)" }}> - {item.resourceType}{item.resourceId ? ` (${item.resourceId.slice(0, 8)})` : ""}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span style={{ color: item.outcome === "failed" ? "var(--danger)" : "var(--muted)" }}>{item.outcome}</span>
                  <time style={{ color: "var(--muted)" }}>{new Date(item.createdAt).toLocaleTimeString()}</time>
                </div>
              </li>
            ))}
          </ul>
          {nextCursor !== null && (
            <button type="button" onClick={() => setCursor(nextCursor)} className="mt-4 w-full rounded-md border py-2 text-sm transition-colors hover:bg-[color:var(--background)]" style={{ borderColor: "var(--panel-border)" }}>
              Load more
            </button>
          )}
        </>
      )}
    </section>
  );
}
