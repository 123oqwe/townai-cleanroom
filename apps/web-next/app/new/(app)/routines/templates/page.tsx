"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";

import { TownApiError } from "@town/web-client";
import type { RoutineTemplate } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";

function defaultNextRun(): string {
  const next = new Date(Date.now() + 60 * 60 * 1000);
  next.setSeconds(0, 0);
  return next.toISOString().slice(0, 16);
}

export default function TemplatesPage() {
  const client = useApiClient();
  const { data, error, isLoading } = useSWR<RoutineTemplate[], TownApiError>(
    "routine-templates",
    () => client.routines.templates.list(),
  );

  const [selected, setSelected] = useState<RoutineTemplate | null>(null);
  const [cron, setCron] = useState("0 8 * * *");
  const [timezone, setTimezone] = useState("UTC");
  const [nextRun, setNextRun] = useState(defaultNextRun());
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installed, setInstalled] = useState(false);

  function selectTemplate(template: RoutineTemplate) {
    setSelected(template);
    setInstallError(null);
    setInstalled(false);
    setCron("0 8 * * *");
    setTimezone("UTC");
    setNextRun(defaultNextRun());
  }

  async function handleInstall() {
    if (selected === null) return;
    setInstalling(true);
    setInstallError(null);
    try {
      await client.routines.templates.install(selected.id, {
        cron: cron.trim(),
        timezone: timezone.trim() || "UTC",
        nextRunAt: new Date(nextRun).toISOString(),
      });
      setInstalled(true);
      setSelected(null);
    } catch (err) {
      setInstallError(
        err instanceof Error ? err.message : "Could not install template.",
      );
    } finally {
      setInstalling(false);
    }
  }

  const templates = data ?? [];

  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <Link
          href="/new/routines"
          className="text-sm transition-colors hover:underline"
          style={{ color: "var(--muted)" }}
        >
          Routines
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">Templates</h1>
      </div>

      {installed && (
        <p
          className="mb-4 rounded-md border px-3 py-2 text-sm"
          style={{ color: "#16a34a", borderColor: "#16a34a" }}
        >
          Template installed.{" "}
          <Link href="/new/routines" className="underline">
            View routines
          </Link>
        </p>
      )}

      {isLoading ? (
        <LoadingState label="Loading templates..." />
      ) : error !== undefined ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error.message}
        </p>
      ) : templates.length === 0 ? (
        <EmptyState title="No stock templates available." />
      ) : (
        <ul className="flex flex-col gap-2">
          {templates.map((template) => (
            <li
              key={template.id}
              className="rounded-lg border p-4"
              style={{
                background: "var(--panel)",
                borderColor: "var(--panel-border)",
              }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <strong className="text-sm">{template.name}</strong>
                  <p
                    className="mt-0.5 text-xs"
                    style={{ color: "var(--muted)" }}
                  >
                    {template.summary}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => selectTemplate(template)}
                  className="rounded-md border px-3 py-1 text-xs transition-colors hover:bg-[color:var(--background)]"
                  style={{ borderColor: "var(--panel-border)" }}
                >
                  Use
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {selected !== null && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="absolute inset-0"
            style={{ background: "rgba(0,0,0,0.4)" }}
            onClick={() => setSelected(null)}
          />
          <div
            className="relative w-full max-w-md rounded-lg border p-5 shadow-xl"
            style={{
              background: "var(--panel)",
              borderColor: "var(--panel-border)",
            }}
          >
            <h2 className="mb-1 text-base font-semibold">{selected.name}</h2>
            <p className="mb-4 text-xs" style={{ color: "var(--muted)" }}>
              {selected.summary}
            </p>
            <div className="flex flex-col gap-3">
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
                First run
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
              {installError !== null && (
                <p
                  className="text-sm"
                  style={{ color: "var(--danger)" }}
                  role="alert"
                >
                  {installError}
                </p>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-[color:var(--background)]"
                style={{ color: "var(--muted)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleInstall}
                disabled={installing}
                className="rounded-md px-3 py-1.5 text-sm font-medium transition-opacity disabled:opacity-60"
                style={{
                  background: "var(--accent)",
                  color: "var(--accent-foreground)",
                }}
              >
                {installing ? "Installing..." : "Install"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
