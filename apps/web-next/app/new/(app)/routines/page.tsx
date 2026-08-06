"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";

import { TownApiError } from "@town/web-client";
import type { Routine } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

export default function RoutinesPage() {
  const client = useApiClient();
  const { data, error, isLoading } = useSWR<Routine[], TownApiError>(
    "routines",
    () => client.routines.list(),
  );
  const [filter, setFilter] = useState("");

  const routines = (data ?? []).filter((r) =>
    r.name.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Routines</h1>
        <div className="flex gap-2">
          <Link
            href="/new/routines/templates"
            className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-[color:var(--background)]"
            style={{ borderColor: "var(--panel-border)" }}
          >
            Templates
          </Link>
        </div>
      </div>

      <input
        type="search"
        placeholder="Filter routines..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="mb-4 w-full rounded-md border p-2 text-sm"
        style={{
          borderColor: "var(--panel-border)",
          background: "var(--background)",
        }}
      />

      {isLoading ? (
        <LoadingState label="Loading routines..." />
      ) : error !== undefined ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error.message}
        </p>
      ) : routines.length === 0 ? (
        <EmptyState
          title="No routines configured yet."
          hint="Install a template or create a routine to get started."
          action={
            <Link
              href="/new/routines/templates"
              className="rounded-md px-3 py-1.5 text-sm font-medium"
              style={{
                background: "var(--accent)",
                color: "var(--accent-foreground)",
              }}
            >
              Browse templates
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {routines.map((routine) => (
            <li key={routine.id}>
              <Link
                href={`/new/routines/${routine.id}`}
                className="block rounded-lg border p-4 transition-colors hover:bg-[color:var(--background)]"
                style={{
                  background: "var(--panel)",
                  borderColor: "var(--panel-border)",
                }}
              >
                <div className="flex items-center justify-between">
                  <strong className="text-sm">{routine.name}</strong>
                  <StatusBadge
                    status={routine.enabled ? "enabled" : "disabled"}
                  />
                </div>
                <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                  {routine.cron} - {routine.timezone}
                  {" - "}
                  {routine.enabled
                    ? `next ${formatTime(routine.nextRunAt)}`
                    : "disabled"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
