"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";

import { TownApiError } from "@town/web-client";
import type { Id } from "@town/contracts";
import type { RoutineVersionPage } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

export default function VersionsPage() {
  const params = useParams<{ id: string }>();
  const client = useApiClient();
  const { data, error, isLoading } = useSWR<RoutineVersionPage, TownApiError>(
    `routines/${params.id as Id<"routine-schedule">}/versions`,
    () => client.routines.versions(params.id as Id<"routine-schedule">, 20),
  );

  const versions = data?.items ?? [];

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
        <h1 className="text-xl font-semibold tracking-tight">Versions</h1>
      </div>

      {isLoading ? (
        <LoadingState label="Loading versions..." />
      ) : error !== undefined ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error.message}
        </p>
      ) : versions.length === 0 ? (
        <EmptyState title="No versions returned." hint="Version history appears after the routine agent is updated." />
      ) : (
        <ul className="flex flex-col gap-2">
          {versions.map((version) => (
            <li
              key={version.id}
              className="rounded-lg border p-4"
              style={{ background: "var(--panel)", borderColor: "var(--panel-border)" }}
            >
              <div className="flex items-center justify-between">
                <strong className="text-sm">Version {version.version}</strong>
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {version.createdBy} - {formatTime(version.createdAt)}
                </span>
              </div>
              <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                {version.snapshot.displayName}
              </p>
              <p className="mt-1 text-xs font-mono" style={{ color: "var(--muted)" }}>
                {version.snapshot.defaultApprovalMode}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
