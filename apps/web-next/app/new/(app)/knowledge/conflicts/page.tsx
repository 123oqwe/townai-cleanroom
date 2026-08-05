"use client";

import { useState } from "react";
import useSWR from "swr";

import { TownApiError } from "@town/web-client";
import type { KnowledgeConflict } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";

export default function ConflictsPage() {
  const client = useApiClient();
  const { data, error, isLoading, mutate } = useSWR<
    KnowledgeConflict[],
    TownApiError
  >("conflicts", () => client.knowledge.conflicts.list());

  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleResolve(
    conflict: KnowledgeConflict,
    resolution: "accept" | "reject",
  ) {
    setBusyId(conflict.id);
    setActionError(null);
    try {
      await client.knowledge.conflicts.resolve(
        conflict.id,
        conflict.currentRevision,
        resolution,
      );
      void mutate();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not resolve conflict.",
      );
    } finally {
      setBusyId(null);
    }
  }

  const conflicts = (data ?? []).filter((c) => c.status === "pending");

  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Conflicts</h1>
        <span className="text-sm" style={{ color: "var(--muted)" }}>
          {conflicts.length} pending
        </span>
      </div>

      {actionError !== null && (
        <p
          className="mb-4 text-sm"
          style={{ color: "var(--danger)" }}
          role="alert"
        >
          {actionError}
        </p>
      )}

      {isLoading ? (
        <LoadingState label="Loading conflicts..." />
      ) : error !== undefined ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error.message}
        </p>
      ) : conflicts.length === 0 ? (
        <EmptyState
          title="No pending conflicts."
          hint="Proposed knowledge changes that need your review appear here."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {conflicts.map((conflict) => (
            <li
              key={conflict.id}
              className="rounded-lg border p-4"
              style={{
                background: "var(--panel)",
                borderColor: "var(--panel-border)",
              }}
            >
              <div className="flex items-center justify-between">
                <strong className="text-sm">
                  {conflict.resourceType} - {conflict.resourceId.slice(0, 8)}
                </strong>
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  base {conflict.baseRevision} -&gt; current{" "}
                  {conflict.currentRevision} - {conflict.proposedAuthorType}
                </span>
              </div>
              <pre
                className="mt-2 overflow-auto rounded-md p-2 text-xs"
                style={{ background: "var(--background)" }}
              >
                {JSON.stringify(conflict.proposedSnapshot, null, 2)}
              </pre>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => handleResolve(conflict, "reject")}
                  disabled={busyId === conflict.id}
                  className="rounded-md border px-3 py-1 text-xs transition-colors hover:bg-[color:var(--background)] disabled:opacity-60"
                  style={{
                    borderColor: "var(--panel-border)",
                    color: "var(--danger)",
                  }}
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => handleResolve(conflict, "accept")}
                  disabled={busyId === conflict.id}
                  className="rounded-md px-3 py-1 text-xs font-medium transition-opacity disabled:opacity-60"
                  style={{
                    background: "var(--accent)",
                    color: "var(--accent-foreground)",
                  }}
                >
                  Accept
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
