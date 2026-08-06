"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";

import { TownApiError } from "@town/web-client";
import type { Id } from "@town/contracts";
import type { RoutineWebhook } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";
import { SecretField } from "@/components/secret-field";
import { StatusBadge } from "@/components/status-badge";

export default function WebhookPage() {
  const params = useParams<{ id: string }>();
  const client = useApiClient();
  const { data, error, isLoading, mutate } = useSWR<
    RoutineWebhook,
    TownApiError
  >(`routines/${params.id as Id<"routine-schedule">}/webhook`, () =>
    client.routines.webhooks.get(
      params.id as Id<"routine-schedule"> as Id<"routine-schedule">,
    ),
  );

  const [secret, setSecret] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/v1/routine-webhooks/${params.id as Id<"routine-schedule">}`
      : "";

  async function handleCreate() {
    setCreating(true);
    setActionError(null);
    try {
      const result = await client.routines.webhooks.create(
        params.id as Id<"routine-schedule"> as Id<"routine-schedule">,
      );
      setSecret(result.secret);
      void mutate();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not create webhook.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleToggle() {
    if (data === undefined) return;
    setToggling(true);
    setActionError(null);
    try {
      await client.routines.webhooks.setEnabled(
        params.id as Id<"routine-schedule">,
        !data.enabled,
      );
      void mutate();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not update webhook.",
      );
    } finally {
      setToggling(false);
    }
  }

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
        <h1 className="text-xl font-semibold tracking-tight">Webhook</h1>
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
        <LoadingState label="Loading webhook..." />
      ) : error !== undefined && error.status === 404 ? (
        <EmptyState
          title="Webhook not configured."
          hint="Create a webhook to trigger this routine via HTTP."
          action={
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="rounded-md px-3 py-1.5 text-sm font-medium transition-opacity disabled:opacity-60"
              style={{
                background: "var(--accent)",
                color: "var(--accent-foreground)",
              }}
            >
              {creating ? "Creating..." : "Create webhook"}
            </button>
          }
        />
      ) : error !== undefined ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error.message}
        </p>
      ) : data !== undefined ? (
        <div
          className="rounded-lg border p-4"
          style={{
            background: "var(--panel)",
            borderColor: "var(--panel-border)",
          }}
        >
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">State</span>
              <StatusBadge status={data.enabled ? "enabled" : "disabled"} />
            </div>
            <button
              type="button"
              onClick={handleToggle}
              disabled={toggling}
              className="rounded-md border px-3 py-1 text-xs transition-colors hover:bg-[color:var(--background)] disabled:opacity-60"
              style={{ borderColor: "var(--panel-border)" }}
            >
              {toggling ? "..." : data.enabled ? "Disable" : "Enable"}
            </button>
          </div>

          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Webhook URL
              <input
                readOnly
                type="text"
                value={webhookUrl}
                className="rounded-md border p-2 font-mono text-xs"
                style={{
                  borderColor: "var(--panel-border)",
                  background: "var(--background)",
                }}
              />
            </label>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Send a POST request with the secret as a Bearer token and an
              X-Town-Idempotency-Key header.
            </p>

            {secret !== null && (
              <SecretField
                label="Secret (shown once)"
                value={secret}
                revealed={true}
                onCopy={() => setSecret(null)}
              />
            )}
            {secret === null && (
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                The secret was shown when the webhook was created. Create a new
                webhook to get a new secret.
              </p>
            )}

            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="self-start rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-[color:var(--background)] disabled:opacity-60"
              style={{ borderColor: "var(--panel-border)" }}
            >
              {creating ? "Rotating..." : "Rotate secret"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
