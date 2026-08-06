"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";

import { TownApiError } from "@town/web-client";
import type { Id } from "@town/contracts";
import type { ContentRevision } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

export default function ContentHistoryPage() {
  const params = useParams<{ id: string }>();
  const client = useApiClient();
  const { data, error, isLoading } = useSWR<ContentRevision[], TownApiError>(
    `content/${params.id}/history`,
    () => client.content.history(params.id as Id<"content">),
  );

  const revisions = data ?? [];

  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center gap-3">
        <Link
          href={`/new/content/${params.id}`}
          className="text-sm transition-colors hover:underline"
          style={{ color: "var(--muted)" }}
        >
          Content
        </Link>
        <span style={{ color: "var(--muted)" }}>/</span>
        <h1 className="text-xl font-semibold tracking-tight">History</h1>
      </div>

      {isLoading ? (
        <LoadingState label="Loading history..." />
      ) : error !== undefined ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error.message}
        </p>
      ) : revisions.length === 0 ? (
        <EmptyState
          title="No revisions yet."
          hint="Revisions appear after content is updated."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {revisions.map((revision) => (
            <li
              key={revision.id}
              className="rounded-lg border p-4"
              style={{
                background: "var(--panel)",
                borderColor: "var(--panel-border)",
              }}
            >
              <div className="flex items-center justify-between">
                <strong className="text-sm">
                  Revision {revision.revision}
                </strong>
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {formatTime(revision.createdAt)}
                </span>
              </div>
              {revision.body !== null && (
                <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
                  {revision.body.slice(0, 200)}
                  {revision.body.length > 200 ? "..." : ""}
                </p>
              )}
              {revision.mimeType !== null && (
                <p
                  className="mt-1 text-xs font-mono"
                  style={{ color: "var(--muted)" }}
                >
                  {revision.mimeType}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
