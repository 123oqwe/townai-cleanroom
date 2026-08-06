"use client";

import { useState } from "react";
import useSWR from "swr";

import {
  TownApiError,
  type Suggestion,
  type SuggestionPage,
} from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";

export default function SuggestionsPage() {
  const client = useApiClient();
  const [refreshing, setRefreshing] = useState(false);
  const { data, error, isLoading, mutate } = useSWR<
    SuggestionPage,
    TownApiError
  >(["suggestions"], () =>
    client.suggestions.list({ status: "open", limit: 20 }),
  );

  const suggestions = data?.items ?? [];

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await client.suggestions.refresh();
      void mutate();
    } finally {
      setRefreshing(false);
    }
  }

  async function dismiss(suggestion: Suggestion) {
    await client.suggestions.update(suggestion.id, {
      expectedRevision: suggestion.revision,
      status: "dismissed",
    });
    void mutate();
  }

  async function convertToTask(suggestion: Suggestion) {
    await client.suggestions.update(suggestion.id, {
      expectedRevision: suggestion.revision,
      status: "converted",
    });
    void mutate();
  }

  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Suggestions</h1>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="rounded-md px-3 py-1.5 text-sm font-medium transition-opacity disabled:opacity-60"
          style={{
            background: "var(--accent)",
            color: "var(--accent-foreground)",
          }}
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {isLoading ? (
        <LoadingState label="Loading suggestions..." />
      ) : error !== undefined ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error.message}
        </p>
      ) : suggestions.length === 0 ? (
        <EmptyState
          title="Nothing needs your attention right now."
          hint="Suggestions from routines and email will appear here."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {suggestions.map((s) => (
            <li
              key={s.id}
              className="rounded-lg border p-4"
              style={{
                background: "var(--panel)",
                borderColor: "var(--panel-border)",
              }}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    {s.kind} - {s.sourceType}
                  </span>
                  <strong className="block text-sm">{s.title}</strong>
                  <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                    {s.body}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => dismiss(s)}
                    className="rounded-md border px-2 py-1 text-xs transition-colors hover:bg-[color:var(--background)]"
                    style={{ borderColor: "var(--panel-border)" }}
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    onClick={() => convertToTask(s)}
                    className="rounded-md px-2 py-1 text-xs font-medium transition-opacity"
                    style={{
                      background: "var(--accent)",
                      color: "var(--accent-foreground)",
                    }}
                  >
                    Make task
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
