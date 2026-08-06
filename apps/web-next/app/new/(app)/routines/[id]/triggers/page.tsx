"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";

import { TownApiError } from "@town/web-client";
import type { Id } from "@town/contracts";
import type { RoutineTrigger, RoutineTriggerKind } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { CodeBlock } from "@/components/code-block";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";

const TRIGGER_KINDS: RoutineTriggerKind[] = [
  "manual",
  "schedule",
  "incoming_email",
  "outgoing_email",
  "email_to_assistant",
  "calendar_start",
  "calendar_end",
  "calendar_rsvp",
  "calendar_changed",
  "voice_transcribed",
  "slack_mention",
  "webhook",
  "telegram_message",
  "whatsapp_message",
];

export default function TriggersPage() {
  const params = useParams<{ id: string }>();
  const client = useApiClient();
  const { data, error, isLoading, mutate } = useSWR<
    RoutineTrigger[],
    TownApiError
  >(`routines/${params.id as Id<"routine-schedule">}/triggers`, () =>
    client.routines.triggers.list(
      params.id as Id<"routine-schedule"> as Id<"routine-schedule">,
    ),
  );

  const [kind, setKind] = useState<RoutineTriggerKind>("webhook");
  const [config, setConfig] = useState("{}");
  const [configError, setConfigError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RoutineTrigger | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleAdd() {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(config || "{}");
    } catch {
      setConfigError("Config must be valid JSON.");
      return;
    }
    setAdding(true);
    setActionError(null);
    try {
      await client.routines.triggers.create(
        params.id as Id<"routine-schedule">,
        { kind, config: parsed },
      );
      setConfig("{}");
      setConfigError(null);
      void mutate();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not add trigger.",
      );
    } finally {
      setAdding(false);
    }
  }

  async function handleToggle(trigger: RoutineTrigger) {
    setActionError(null);
    try {
      await client.routines.triggers.update(trigger.id, {
        expectedRevision: trigger.revision,
        config: trigger.config,
        enabled: !trigger.enabled,
      });
      void mutate();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not update trigger.",
      );
    }
  }

  async function handleDelete() {
    if (deleteTarget === null) return;
    try {
      await client.routines.triggers.delete(
        deleteTarget.id,
        deleteTarget.revision,
      );
      setDeleteTarget(null);
      void mutate();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not remove trigger.",
      );
      setDeleteTarget(null);
    }
  }

  const triggers = data ?? [];

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
        <h1 className="text-xl font-semibold tracking-tight">Triggers</h1>
      </div>

      {isLoading ? (
        <LoadingState label="Loading triggers..." />
      ) : error !== undefined ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error.message}
        </p>
      ) : triggers.length === 0 ? (
        <EmptyState
          title="No triggers configured."
          hint="Add a trigger to automate this routine."
        />
      ) : (
        <ul className="mb-6 flex flex-col gap-2">
          {triggers.map((trigger) => (
            <li
              key={trigger.id}
              className="rounded-lg border p-4"
              style={{
                background: "var(--panel)",
                borderColor: "var(--panel-border)",
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <strong className="text-sm font-mono">{trigger.kind}</strong>
                  <StatusBadge
                    status={trigger.enabled ? "enabled" : "disabled"}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggle(trigger)}
                    className="rounded-md border px-2 py-1 text-xs transition-colors hover:bg-[color:var(--background)]"
                    style={{ borderColor: "var(--panel-border)" }}
                  >
                    {trigger.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(trigger)}
                    className="rounded-md border px-2 py-1 text-xs transition-colors hover:bg-[color:var(--background)]"
                    style={{
                      borderColor: "var(--panel-border)",
                      color: "var(--danger)",
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
              <div className="mt-2">
                <CodeBlock label="config">
                  {JSON.stringify(trigger.config ?? {}, null, 2)}
                </CodeBlock>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div
        className="rounded-lg border p-4"
        style={{
          background: "var(--panel)",
          borderColor: "var(--panel-border)",
        }}
      >
        <h2 className="mb-3 text-sm font-semibold">Add trigger</h2>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Kind
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as RoutineTriggerKind)}
              className="rounded-md border p-2"
              style={{
                borderColor: "var(--panel-border)",
                background: "var(--background)",
              }}
            >
              {TRIGGER_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Config (JSON)
            <textarea
              rows={3}
              value={config}
              onChange={(e) => setConfig(e.target.value)}
              className="rounded-md border p-2 font-mono text-xs"
              style={{
                borderColor: "var(--panel-border)",
                background: "var(--background)",
              }}
            />
          </label>
          {configError !== null && (
            <p className="text-sm" style={{ color: "var(--danger)" }}>
              {configError}
            </p>
          )}
          {actionError !== null && (
            <p className="text-sm" style={{ color: "var(--danger)" }}>
              {actionError}
            </p>
          )}
          <button
            type="button"
            onClick={handleAdd}
            disabled={adding}
            className="self-start rounded-md px-3 py-1.5 text-sm font-medium transition-opacity disabled:opacity-60"
            style={{
              background: "var(--accent)",
              color: "var(--accent-foreground)",
            }}
          >
            {adding ? "Adding..." : "Add trigger"}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Remove trigger"
        message="Remove this trigger? This cannot be undone."
        confirmLabel="Remove"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}
