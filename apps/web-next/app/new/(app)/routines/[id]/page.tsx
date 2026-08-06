"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";

import { TownApiError } from "@town/web-client";
import type { Id } from "@town/contracts";
import type { Routine } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";

function toLocalInput(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16);
}

export default function RoutineDetailPage() {
  const params = useParams<{ id: string }>();
  const client = useApiClient();
  const { data, error, isLoading, mutate } = useSWR<Routine, TownApiError>(
    `routines/${params.id as Id<"routine-schedule">}`,
    () =>
      client.routines.get(
        params.id as Id<"routine-schedule"> as Id<"routine-schedule">,
      ),
  );

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [cron, setCron] = useState("");
  const [timezone, setTimezone] = useState("");
  const [nextRun, setNextRun] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [runInput, setRunInput] = useState("");
  const [runStatus, setRunStatus] = useState<string | null>(null);

  function startEdit(routine: Routine) {
    setName(routine.name);
    setCron(routine.cron);
    setTimezone(routine.timezone);
    setNextRun(toLocalInput(routine.nextRunAt));
    setEnabled(routine.enabled);
    setSaveError(null);
    setEditing(true);
  }

  async function handleSave() {
    if (data === undefined) return;
    setSaving(true);
    setSaveError(null);
    try {
      await client.routines.update(data.id, {
        agentId: data.agentId,
        agentVersionId: data.agentVersionId,
        name: name.trim(),
        cron: cron.trim(),
        timezone: timezone.trim() || "UTC",
        nextRunAt: new Date(nextRun).toISOString(),
        enabled,
        expectedRevision: data.revision,
      });
      setEditing(false);
      void mutate();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Could not save routine.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (data === undefined) return;
    try {
      await client.routines.delete(data.id, data.revision);
      setDeleteOpen(false);
      window.location.href = "/new/routines";
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Could not delete routine.",
      );
      setDeleteOpen(false);
    }
  }

  async function handleRun() {
    if (data === undefined || runInput.trim() === "") return;
    try {
      const result = await client.routines.run(data.id, runInput.trim());
      setRunStatus(`Queued ${result.run.status}`);
      setRunInput("");
    } catch (err) {
      setRunStatus(
        err instanceof Error ? err.message : "Could not run routine.",
      );
    }
  }

  if (isLoading) return <LoadingState label="Loading routine..." />;
  if (error !== undefined)
    return (
      <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
        {error.message}
      </p>
    );
  if (data === undefined) return <EmptyState title="Routine not found." />;

  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center gap-3">
        <Link
          href="/new/routines"
          className="text-sm transition-colors hover:underline"
          style={{ color: "var(--muted)" }}
        >
          Routines
        </Link>
        <span style={{ color: "var(--muted)" }}>/</span>
        <h1 className="text-xl font-semibold tracking-tight">{data.name}</h1>
      </div>

      <nav className="mb-6 flex gap-1 text-sm">
        {[
          { href: "", label: "Config" },
          { href: "/triggers", label: "Triggers" },
          { href: "/runs", label: "Runs" },
          { href: "/webhook", label: "Webhook" },
          { href: "/versions", label: "Versions" },
        ].map((tab) => (
          <Link
            key={tab.label}
            href={`/new/routines/${data.id}${tab.href}`}
            className="rounded-md px-3 py-1.5 transition-colors hover:bg-[color:var(--background)]"
            style={{
              background: tab.href === "" ? "var(--panel)" : "transparent",
              borderColor: "var(--panel-border)",
              border:
                tab.href === ""
                  ? "1px solid var(--panel-border)"
                  : "1px solid transparent",
            }}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div
        className="mb-6 rounded-lg border p-4"
        style={{
          background: "var(--panel)",
          borderColor: "var(--panel-border)",
        }}
      >
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt style={{ color: "var(--muted)" }}>Cron</dt>
            <dd className="font-mono">{data.cron}</dd>
          </div>
          <div>
            <dt style={{ color: "var(--muted)" }}>Timezone</dt>
            <dd>{data.timezone}</dd>
          </div>
          <div>
            <dt style={{ color: "var(--muted)" }}>Enabled</dt>
            <dd>{data.enabled ? "Yes" : "No"}</dd>
          </div>
          <div>
            <dt style={{ color: "var(--muted)" }}>Next run</dt>
            <dd>{new Date(data.nextRunAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt style={{ color: "var(--muted)" }}>Revision</dt>
            <dd>{data.revision}</dd>
          </div>
        </dl>
      </div>

      <div className="mb-6 flex gap-2">
        <button
          type="button"
          onClick={() => startEdit(data)}
          className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-[color:var(--background)]"
          style={{ borderColor: "var(--panel-border)" }}
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-[color:var(--background)]"
          style={{ borderColor: "var(--panel-border)", color: "var(--danger)" }}
        >
          Delete
        </button>
      </div>

      <div
        className="mb-6 rounded-lg border p-4"
        style={{
          background: "var(--panel)",
          borderColor: "var(--panel-border)",
        }}
      >
        <h2 className="mb-3 text-sm font-semibold">Run now</h2>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Input text..."
            value={runInput}
            onChange={(e) => setRunInput(e.target.value)}
            className="flex-1 rounded-md border p-2 text-sm"
            style={{
              borderColor: "var(--panel-border)",
              background: "var(--background)",
            }}
          />
          <button
            type="button"
            onClick={handleRun}
            disabled={runInput.trim() === ""}
            className="rounded-md px-3 py-2 text-sm font-medium transition-opacity disabled:opacity-60"
            style={{
              background: "var(--accent)",
              color: "var(--accent-foreground)",
            }}
          >
            Run
          </button>
        </div>
        {runStatus !== null && (
          <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
            {runStatus}
          </p>
        )}
      </div>

      {editing && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="absolute inset-0"
            style={{ background: "rgba(0,0,0,0.4)" }}
            onClick={() => setEditing(false)}
          />
          <div
            className="relative w-full max-w-md rounded-lg border p-5 shadow-xl"
            style={{
              background: "var(--panel)",
              borderColor: "var(--panel-border)",
            }}
          >
            <h2 className="mb-4 text-base font-semibold">Edit routine</h2>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm">
                Name
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="rounded-md border p-2"
                  style={{
                    borderColor: "var(--panel-border)",
                    background: "var(--background)",
                  }}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Cron
                <input
                  type="text"
                  value={cron}
                  onChange={(e) => setCron(e.target.value)}
                  className="rounded-md border p-2 font-mono text-xs"
                  style={{
                    borderColor: "var(--panel-border)",
                    background: "var(--background)",
                  }}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Timezone
                <input
                  type="text"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="rounded-md border p-2"
                  style={{
                    borderColor: "var(--panel-border)",
                    background: "var(--background)",
                  }}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Next run
                <input
                  type="datetime-local"
                  value={nextRun}
                  onChange={(e) => setNextRun(e.target.value)}
                  className="rounded-md border p-2"
                  style={{
                    borderColor: "var(--panel-border)",
                    background: "var(--background)",
                  }}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                Enabled
              </label>
              {saveError !== null && (
                <p
                  className="text-sm"
                  style={{ color: "var(--danger)" }}
                  role="alert"
                >
                  {saveError}
                </p>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-[color:var(--background)]"
                style={{ color: "var(--muted)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-md px-3 py-1.5 text-sm font-medium transition-opacity disabled:opacity-60"
                style={{
                  background: "var(--accent)",
                  color: "var(--accent-foreground)",
                }}
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteOpen}
        title="Delete routine"
        message={`Delete "${data.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </section>
  );
}
