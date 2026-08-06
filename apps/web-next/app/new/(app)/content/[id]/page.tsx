"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";

import { TownApiError } from "@town/web-client";
import type { Id } from "@town/contracts";
import type { ContentItem } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { CodeBlock } from "@/components/code-block";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";

export default function ContentDetailPage() {
  const params = useParams<{ id: string }>();
  const client = useApiClient();
  const { data, error, isLoading, mutate } = useSWR<ContentItem, TownApiError>(
    `content/${params.id}`,
    () => client.content.get(params.id as Id<"content">),
  );

  const [, setArchiving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    if (data === undefined) return;
    setDownloading(true);
    setActionError(null);
    try {
      const blob = await client.content.blob(data.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.title || data.id;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not download file.");
    } finally {
      setDownloading(false);
    }
  }

  async function handleArchive() {
    if (data === undefined) return;
    setArchiving(true);
    setActionError(null);
    try {
      await client.content.archive(data.id);
      setArchiveOpen(false);
      void mutate();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not archive content.");
      setArchiveOpen(false);
    } finally {
      setArchiving(false);
    }
  }

  if (isLoading) return <LoadingState label="Loading content..." />;
  if (error !== undefined)
    return (
      <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
        {error.message}
      </p>
    );
  if (data === undefined)
    return <EmptyState title="Content not found." />;

  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center gap-3">
        <Link
          href="/new/content"
          className="text-sm transition-colors hover:underline"
          style={{ color: "var(--muted)" }}
        >
          Content
        </Link>
        <span style={{ color: "var(--muted)" }}>/</span>
        <h1 className="text-xl font-semibold tracking-tight">{data.title}</h1>
      </div>

      <div className="mb-4 flex gap-2">
        <Link
          href={`/new/content/${data.id}/history`}
          className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-[color:var(--background)]"
          style={{ borderColor: "var(--panel-border)" }}
        >
          History
        </Link>
        {data.storageKey !== null && (
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-[color:var(--background)] disabled:opacity-60"
            style={{ borderColor: "var(--panel-border)" }}
          >
            {downloading ? "Downloading..." : "Download"}
          </button>
        )}
        {data.status === "active" && (
          <button
            type="button"
            onClick={() => setArchiveOpen(true)}
            className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-[color:var(--background)]"
            style={{ borderColor: "var(--panel-border)", color: "var(--danger)" }}
          >
            Archive
          </button>
        )}
      </div>

      {actionError !== null && (
        <p className="mb-4 text-sm" style={{ color: "var(--danger)" }} role="alert">
          {actionError}
        </p>
      )}

      <div
        className="mb-6 rounded-lg border p-4"
        style={{ background: "var(--panel)", borderColor: "var(--panel-border)" }}
      >
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt style={{ color: "var(--muted)" }}>Kind</dt>
            <dd>{data.kind}</dd>
          </div>
          <div>
            <dt style={{ color: "var(--muted)" }}>Status</dt>
            <dd><StatusBadge status={data.status} /></dd>
          </div>
          <div>
            <dt style={{ color: "var(--muted)" }}>MIME type</dt>
            <dd className="font-mono text-xs">{data.mimeType ?? "N/A"}</dd>
          </div>
          <div>
            <dt style={{ color: "var(--muted)" }}>Revision</dt>
            <dd>{data.currentRevision}</dd>
          </div>
          <div>
            <dt style={{ color: "var(--muted)" }}>Created</dt>
            <dd>{new Date(data.createdAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt style={{ color: "var(--muted)" }}>Updated</dt>
            <dd>{new Date(data.updatedAt).toLocaleString()}</dd>
          </div>
        </dl>
      </div>

      {data.body !== null && (
        <CodeBlock label="body">{data.body}</CodeBlock>
      )}

      {data.storageKey !== null && (
        <p className="mt-4 text-xs" style={{ color: "var(--muted)" }}>
          Stored at: {data.storageKey}
        </p>
      )}

      {Object.keys(data.metadata).length > 0 && (
        <div className="mt-4">
          <CodeBlock label="metadata">
            {JSON.stringify(data.metadata, null, 2)}
          </CodeBlock>
        </div>
      )}

      <ConfirmDialog
        open={archiveOpen}
        title="Archive content"
        message={`Archive "${data.title}"? Archived content is hidden from the active library.`}
        confirmLabel="Archive"
        destructive
        onConfirm={handleArchive}
        onCancel={() => setArchiveOpen(false)}
      />
    </section>
  );
}
