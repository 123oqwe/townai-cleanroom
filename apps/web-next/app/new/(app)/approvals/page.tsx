"use client";

import { useState } from "react";
import useSWR from "swr";

import {
  TownApiError,
  type Approval,
  type ApprovalPage,
} from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";

export default function ApprovalsPage() {
  const client = useApiClient();
  const { data, error, isLoading, mutate } = useSWR<ApprovalPage, TownApiError>(
    ["approvals"],
    () => client.approvals.list({ limit: 50 }),
  );

  const [selected, setSelected] = useState<Approval | null>(null);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const approvals = data?.items ?? [];

  async function inspect(a: Approval) {
    setLoadingDetail(true);
    try {
      const call = await client.tools.calls.get(a.toolCallId);
      setDetail({ ...a, toolCall: call });
    } catch {
      setDetail({ ...a });
    } finally {
      setLoadingDetail(false);
    }
  }

  async function handleDecision() {
    if (selected === null || decision === null) return;
    await client.approvals.decide(selected.id, {
      expectedRevision: selected.revision,
      decision,
    });
    setSelected(null);
    setDecision(null);
    void mutate();
  }

  return (
    <section className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-xl font-semibold tracking-tight">Approvals</h1>

      {isLoading ? (
        <LoadingState label="Loading approvals..." />
      ) : error !== undefined ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error.message}
        </p>
      ) : approvals.length === 0 ? (
        <EmptyState
          title="No pending approvals."
          hint="Tool calls requiring approval will appear here."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {approvals.map((a) => (
            <li
              key={a.id}
              className="rounded-lg border p-4"
              style={{
                background: "var(--panel)",
                borderColor: "var(--panel-border)",
              }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <strong className="text-sm">
                    Tool call {a.toolCallId.slice(0, 8)}
                  </strong>
                  <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                    {JSON.stringify(a.arguments)}
                  </p>
                  {a.expiresAt && (
                    <p className="text-xs" style={{ color: "var(--muted)" }}>
                      expires {new Date(a.expiresAt).toLocaleString()}
                    </p>
                  )}
                </div>
                <StatusBadge status={a.status} />
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => inspect(a)}
                  disabled={loadingDetail}
                  className="rounded-md border px-2 py-1 text-xs transition-colors hover:bg-[color:var(--background)]"
                  style={{ borderColor: "var(--panel-border)" }}
                >
                  Inspect
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(a);
                    setDecision("reject");
                  }}
                  className="rounded-md border px-2 py-1 text-xs transition-colors"
                  style={{
                    borderColor: "var(--danger)",
                    color: "var(--danger)",
                  }}
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(a);
                    setDecision("approve");
                  }}
                  className="rounded-md px-2 py-1 text-xs font-medium transition-opacity"
                  style={{
                    background: "var(--accent)",
                    color: "var(--accent-foreground)",
                  }}
                >
                  Approve
                </button>
              </div>
              {detail && detail["id"] === a.id && (
                <pre
                  className="mt-2 overflow-auto rounded-md p-2 text-xs"
                  style={{ background: "var(--background)" }}
                >
                  {JSON.stringify(detail, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={selected !== null && decision !== null}
        title={
          decision === "approve" ? "Approve tool call?" : "Reject tool call?"
        }
        message={`Are you sure you want to ${decision} this tool call?`}
        confirmLabel={decision === "approve" ? "Approve" : "Reject"}
        destructive={decision === "reject"}
        onConfirm={handleDecision}
        onCancel={() => {
          setSelected(null);
          setDecision(null);
        }}
      />
    </section>
  );
}
