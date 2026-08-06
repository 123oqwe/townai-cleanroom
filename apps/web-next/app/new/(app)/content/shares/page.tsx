"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";

import { TownApiError } from "@town/web-client";
import type { Id } from "@town/contracts";
import type { ContentPage } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";
import { SecretField } from "@/components/secret-field";

export default function ContentSharesPage() {
  const client = useApiClient();
  const { data, error, isLoading } = useSWR<ContentPage, TownApiError>(
    "content/shares-list",
    () => client.content.list({ status: "active", limit: 50 }),
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const items = data?.items ?? [];

  async function handleCreate() {
    if (selectedId === null) return;
    setCreating(true);
    setActionError(null);
    try {
      const result = await client.content.shares.create(selectedId as Id<"content">);
      const url = `${typeof window !== "undefined" ? window.location.origin : ""}/v1/content-shares/${result.token}`;
      setShareUrl(url);
      setShareId(result.share.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not create share.");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke() {
    if (shareId === null) return;
    setActionError(null);
    try {
      await client.content.shares.delete(shareId as Id<"content-share">);
      setShareUrl(null);
      setShareId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not revoke share.");
    }
  }

  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <Link
          href="/new/content"
          className="text-sm transition-colors hover:underline"
          style={{ color: "var(--muted)" }}
        >
          Content
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">Shares</h1>
      </div>

      {actionError !== null && (
        <p className="mb-4 text-sm" style={{ color: "var(--danger)" }} role="alert">
          {actionError}
        </p>
      )}

      {shareUrl !== null && shareId !== null && (
        <div
          className="mb-6 rounded-lg border p-4"
          style={{ background: "var(--panel)", borderColor: "var(--panel-border)" }}
        >
          <h2 className="mb-3 text-sm font-semibold">Active share link</h2>
          <div className="flex flex-col gap-3">
            <SecretField label="Share URL (shown once)" value={shareUrl} revealed={true} />
            <button
              type="button"
              onClick={handleRevoke}
              className="self-start rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-[color:var(--background)]"
              style={{ borderColor: "var(--panel-border)", color: "var(--danger)" }}
            >
              Revoke
            </button>
          </div>
        </div>
      )}

      <div
        className="mb-6 rounded-lg border p-4"
        style={{ background: "var(--panel)", borderColor: "var(--panel-border)" }}
      >
        <h2 className="mb-3 text-sm font-semibold">Create share link</h2>
        <div className="flex flex-col gap-3">
          {isLoading ? (
            <LoadingState label="Loading content..." />
          ) : error !== undefined ? (
            <p className="text-sm" style={{ color: "var(--danger)" }}>{error.message}</p>
          ) : items.length === 0 ? (
            <EmptyState title="No content to share." hint="Save content first to create share links." />
          ) : (
            <>
              <label className="flex flex-col gap-1 text-sm">
                Content
                <select
                  value={selectedId ?? ""}
                  onChange={(e) => setSelectedId(e.target.value || null)}
                  className="rounded-md border p-2"
                  style={{
                    borderColor: "var(--panel-border)",
                    background: "var(--background)",
                  }}
                >
                  <option value="">Select content...</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating || selectedId === null}
                className="self-start rounded-md px-3 py-1.5 text-sm font-medium transition-opacity disabled:opacity-60"
                style={{
                  background: "var(--accent)",
                  color: "var(--accent-foreground)",
                }}
              >
                {creating ? "Creating..." : "Create link"}
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
