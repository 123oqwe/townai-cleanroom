"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";

import { TownApiError } from "@town/web-client";
import type { Id } from "@town/contracts";
import type { RoutineRun } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

const TERMINAL = new Set(["succeeded", "failed", "blocked"]);

export default function RunsPage() {
  const params = useParams<{ id: string }>();
  const client = useApiClient();
  const { data, error, isLoading, mutate } = useSWR<RoutineRun[], TownApiError>(
    `routines/${params.id as Id<"routine-schedule">}/runs`,
    () => client.routines.runs.list(params.id as Id<"routine-schedule">, 50),
  );
  const [replaying, setReplaying] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleReplay(runId: Id<"integration-sync-run">) {
    setReplaying(runId);
    setActionError(null);
    try {
      await client.routines.runs.replay(runId);
      void mutate();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not replay run.",
      );
    } finally {
      setReplaying(null);
    }
  }

  const runs = data ?? [];

  if (isLoading) return <LoadingState label="Loading runs..." />;
  if (error !== undefined)
    return (
      <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
        {error.message}
      </p>
    );

  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center gap-3">
        <Link
          href={`/new/routines/${params.id as Id<"routine-schedule">}`}
          className="text-sm transition-colors hover:underline"
          style={{ color: "var(--muted)" }}
        >
          {params.id.slice(0, 8)}
        </Link>
        <span style={{ color: "var(--muted)" }}>/</span>
        <h1 className="text-xl font-semibold tracking-tight">Runs</h1>
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

      {runs.length === 0 ? (
        <EmptyState
          title="No runs recorded yet."
          hint="Runs appear here after the routine executes."
        />
      ) : (
        <DataTable
          rows={runs}
          rowKey={(run) => run.id}
          columns={[
            {
              key: "status",
              header: "Status",
              render: (run) => <StatusBadge status={run.status} />,
            },
            {
              key: "trigger",
              header: "Trigger",
              render: (run) => (
                <span className="font-mono text-xs">{run.triggerType}</span>
              ),
            },
            {
              key: "time",
              header: "Created",
              render: (run) => (
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {formatTime(run.createdAt)}
                </span>
              ),
            },
            {
              key: "actions",
              header: "",
              render: (run) =>
                TERMINAL.has(run.status) ? (
                  <button
                    type="button"
                    onClick={() => handleReplay(run.id)}
                    disabled={replaying === run.id}
                    className="rounded-md border px-2 py-1 text-xs transition-colors hover:bg-[color:var(--background)] disabled:opacity-60"
                    style={{ borderColor: "var(--panel-border)" }}
                  >
                    {replaying === run.id ? "Replaying..." : "Replay"}
                  </button>
                ) : null,
            },
          ]}
        />
      )}
    </section>
  );
}
