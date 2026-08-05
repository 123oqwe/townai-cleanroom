"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";

import { TownApiError } from "@town/web-client";
import type { ThreadPage } from "@town/web-client";

import { useApiClient } from "@/app/api-client";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export default function ThreadsPage() {
  const client = useApiClient();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const { data, error, isLoading, mutate } = useSWR<ThreadPage, TownApiError>(
    "threads",
    () => client.threads.list({ limit: 50 }),
  );

  async function handleNewThread() {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const thread = await client.threads.create({
        title: `Thread ${new Date().toLocaleString()}`,
        approvalMode: "respect_tool_setting",
      });
      void mutate();
      router.push(`/new/threads/${thread.id}`);
    } catch (err) {
      setCreateError(
        err instanceof TownApiError ? err.message : "Could not create thread.",
      );
      setCreating(false);
    }
  }

  const threads = data?.items ?? [];

  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Threads</h1>
        <button
          type="button"
          onClick={handleNewThread}
          disabled={creating}
          className="rounded-md px-3 py-1.5 text-sm font-medium transition-opacity disabled:opacity-60"
          style={{
            background: "var(--accent)",
            color: "var(--accent-foreground)",
          }}
        >
          {creating ? "Creating…" : "New thread"}
        </button>
      </div>

      {createError !== null && (
        <p
          className="mb-4 text-sm"
          style={{ color: "var(--danger)" }}
          role="alert"
        >
          {createError}
        </p>
      )}

      {isLoading ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Loading threads…
        </p>
      ) : error !== undefined ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error.message}
        </p>
      ) : threads.length === 0 ? (
        <div
          className="rounded-lg border border-dashed p-10 text-center"
          style={{ borderColor: "var(--panel-border)" }}
        >
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            No threads yet. Start a new one to begin.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {threads.map((thread) => (
            <li key={thread.id}>
              <Link
                href={`/new/threads/${thread.id}`}
                className="flex items-center justify-between rounded-lg border px-4 py-3 transition-colors hover:border-[color:var(--accent)]"
                style={{
                  background: "var(--panel)",
                  borderColor: "var(--panel-border)",
                }}
              >
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{thread.title}</span>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    {thread.kind} · revised {thread.revision}
                  </span>
                </span>
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {formatDate(thread.updatedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
