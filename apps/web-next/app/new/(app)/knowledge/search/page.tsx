"use client";

import { useState } from "react";
import useSWR from "swr";

import { TownApiError } from "@town/web-client";
import type { KnowledgeSearchPage } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";

interface SearchResultRow {
  title: string;
  resourceType: string;
  resourceId: string;
  score: string;
  text: string;
}

export default function SearchPage() {
  const client = useApiClient();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);

  const { data, error, isValidating } = useSWR<
    KnowledgeSearchPage,
    TownApiError
  >(submitted === null ? null : `search:${submitted}`, () =>
    submitted === null
      ? Promise.reject(new Error("No query submitted."))
      : client.knowledge.search.search(submitted, { limit: 20 }),
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed === "") return;
    setSubmitted(trimmed);
  }

  const rows: SearchResultRow[] = (data?.items ?? []).map((item) => ({
    title: item.title ?? item.resourceType,
    resourceType: item.resourceType,
    resourceId: item.resourceId,
    score: `${Math.round(item.score * 100)}%`,
    text: item.text,
  }));

  const columns: DataTableColumn<SearchResultRow>[] = [
    { key: "title", header: "Title", render: (r) => r.title },
    { key: "type", header: "Type", render: (r) => r.resourceType },
    { key: "score", header: "Match", render: (r) => r.score },
    {
      key: "text",
      header: "Excerpt",
      render: (r) => (
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          {r.text}
        </span>
      ),
    },
  ];

  return (
    <section className="mx-auto max-w-4xl">
      <h1 className="mb-6 text-xl font-semibold tracking-tight">Search</h1>
      <form onSubmit={handleSubmit} className="mb-6 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your durable context..."
          className="flex-1 rounded-md border p-2 text-sm"
          style={{
            borderColor: "var(--panel-border)",
            background: "var(--panel)",
          }}
        />
        <button
          type="submit"
          disabled={query.trim() === ""}
          className="rounded-md px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-60"
          style={{
            background: "var(--accent)",
            color: "var(--accent-foreground)",
          }}
        >
          Search
        </button>
      </form>

      {submitted === null ? (
        <EmptyState
          title="Search across memories, people, wiki, and more."
          hint="Enter a query to begin."
        />
      ) : isValidating && data === undefined ? (
        <LoadingState label="Searching..." />
      ) : error !== undefined ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error.message}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState title="No matching durable context." />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => `${r.resourceType}-${r.resourceId}`}
        />
      )}
    </section>
  );
}
