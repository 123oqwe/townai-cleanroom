"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";

import { TownApiError } from "@town/web-client";
import type { ContentItem, ContentPage } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";

export default function ContentLibraryPage() {
  const client = useApiClient();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ContentItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const { data, error, isLoading } = useSWR<ContentPage, TownApiError>(
    ["content", cursor],
    () => client.content.list({ status: "active", limit: 20, cursor }),
    {
      onSuccess: (page) => {
        setItems((prev) =>
          cursor === undefined ? page.items : [...prev, ...page.items],
        );
      },
    },
  );

  const nextCursor = data?.nextCursor ?? null;

  function loadMore() {
    if (nextCursor === null) return;
    setLoadingMore(true);
    setCursor(nextCursor);
  }

  async function handleSearch() {
    const q = searchQuery.trim();
    if (q === "") {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const page = await client.knowledge.search.search(q, { limit: 20 });
      const contentItems = page.items
        
        .map((r) => ({
          id: r.resourceId as ContentItem["id"],
          ownerId: "" as ContentItem["ownerId"],
          kind: "document" as ContentItem["kind"],
          title: r.title ?? r.text.slice(0, 60),
          mimeType: null,
          storageKey: null,
          body: r.text,
          metadata: {},
          sourceSessionId: null,
          status: r.status as ContentItem["status"],
          currentRevision: 0,
          createdAt: r.updatedAt,
          updatedAt: r.updatedAt,
        }));
      setSearchResults(contentItems);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  const displayItems = searchResults ?? items;

  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Content Library</h1>
        <div className="flex gap-2">
          <Link
            href="/new/content/collections"
            className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-[color:var(--background)]"
            style={{ borderColor: "var(--panel-border)" }}
          >
            Collections
          </Link>
          <Link
            href="/new/content/shares"
            className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-[color:var(--background)]"
            style={{ borderColor: "var(--panel-border)" }}
          >
            Shares
          </Link>
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        <input
          type="search"
          placeholder="Search content..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSearch();
          }}
          className="flex-1 rounded-md border p-2 text-sm"
          style={{
            borderColor: "var(--panel-border)",
            background: "var(--background)",
          }}
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={searching}
          className="rounded-md px-3 py-2 text-sm font-medium transition-opacity disabled:opacity-60"
          style={{
            background: "var(--accent)",
            color: "var(--accent-foreground)",
          }}
        >
          {searching ? "..." : "Search"}
        </button>
        {searchResults !== null && (
          <button
            type="button"
            onClick={() => {
              setSearchResults(null);
              setSearchQuery("");
            }}
            className="rounded-md border px-3 py-2 text-sm transition-colors hover:bg-[color:var(--background)]"
            style={{ borderColor: "var(--panel-border)" }}
          >
            Clear
          </button>
        )}
      </div>

      {isLoading && cursor === undefined ? (
        <LoadingState label="Loading content..." />
      ) : error !== undefined ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error.message}
        </p>
      ) : displayItems.length === 0 ? (
        <EmptyState
          title={searchResults !== null ? "No matching content found." : "No saved content yet."}
          hint={searchResults !== null ? "Try a different search term." : "Content saved by routines will appear here."}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {displayItems.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/new/content/${item.id}`}
                  className="block rounded-lg border p-4 transition-colors hover:bg-[color:var(--background)]"
                  style={{
                    background: "var(--panel)",
                    borderColor: "var(--panel-border)",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <strong className="text-sm">{item.title}</strong>
                    <StatusBadge status={item.status} />
                  </div>
                  {item.body !== null && (
                    <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                      {item.body.slice(0, 120)}
                      {item.body.length > 120 ? "..." : ""}
                    </p>
                  )}
                  <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                    {item.kind}
                    {item.mimeType !== null ? ` - ${item.mimeType}` : ""}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
          {searchResults === null && nextCursor !== null && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-4 w-full rounded-md border py-2 text-sm transition-colors hover:bg-[color:var(--background)] disabled:opacity-60"
              style={{ borderColor: "var(--panel-border)" }}
            >
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
