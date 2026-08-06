"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";

import { TownApiError } from "@town/web-client";
import type { Id } from "@town/contracts";
import type { ContentCollection, ContentItem } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";

export default function CollectionsPage() {
  const client = useApiClient();
  const { data, error, isLoading, mutate } = useSWR<
    ContentCollection[],
    TownApiError
  >("content/collections", () => client.content.collections.list());

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const {
    data: items,
    error: itemsError,
    isLoading: itemsLoading,
  } = useSWR<ContentItem[], TownApiError>(
    openId !== null ? `content/collections/${openId}` : null,
    () => (openId !== null ? client.content.collections.get(openId as Id<"content-collection">) : Promise.resolve([])),
  );

  async function handleCreate() {
    if (name.trim() === "") return;
    setAdding(true);
    setAddError(null);
    try {
      await client.content.collections.create({
        name: name.trim(),
        ...(description.trim() !== "" ? { description: description.trim() } : {}),
      });
      setName("");
      setDescription("");
      void mutate();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Could not create collection.");
    } finally {
      setAdding(false);
    }
  }

  const collections = data ?? [];

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
        <h1 className="text-xl font-semibold tracking-tight">Collections</h1>
      </div>

      <div
        className="mb-6 rounded-lg border p-4"
        style={{ background: "var(--panel)", borderColor: "var(--panel-border)" }}
      >
        <h2 className="mb-3 text-sm font-semibold">New collection</h2>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border p-2"
              style={{
                borderColor: "var(--panel-border)",
                background: "var(--background)",
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Description
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="rounded-md border p-2"
              style={{
                borderColor: "var(--panel-border)",
                background: "var(--background)",
              }}
            />
          </label>
          {addError !== null && (
            <p className="text-sm" style={{ color: "var(--danger)" }}>{addError}</p>
          )}
          <button
            type="button"
            onClick={handleCreate}
            disabled={adding || name.trim() === ""}
            className="self-start rounded-md px-3 py-1.5 text-sm font-medium transition-opacity disabled:opacity-60"
            style={{
              background: "var(--accent)",
              color: "var(--accent-foreground)",
            }}
          >
            {adding ? "Creating..." : "Create"}
          </button>
        </div>
      </div>

      {isLoading ? (
        <LoadingState label="Loading collections..." />
      ) : error !== undefined ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error.message}
        </p>
      ) : collections.length === 0 ? (
        <EmptyState title="No collections yet." hint="Create a collection to organize content." />
      ) : (
        <ul className="flex flex-col gap-2">
          {collections.map((collection) => (
            <li
              key={collection.id}
              className="rounded-lg border p-4"
              style={{ background: "var(--panel)", borderColor: "var(--panel-border)" }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <strong className="text-sm">{collection.name}</strong>
                  {collection.description && (
                    <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
                      {collection.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setOpenId(openId === collection.id ? null : collection.id)
                  }
                  className="rounded-md border px-3 py-1 text-xs transition-colors hover:bg-[color:var(--background)]"
                  style={{ borderColor: "var(--panel-border)" }}
                >
                  {openId === collection.id ? "Close" : "Open"}
                </button>
              </div>
              {openId === collection.id && (
                <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--panel-border)" }}>
                  {itemsLoading ? (
                    <p className="text-xs" style={{ color: "var(--muted)" }}>Loading items...</p>
                  ) : itemsError !== undefined ? (
                    <p className="text-xs" style={{ color: "var(--danger)" }}>{itemsError.message}</p>
                  ) : (items ?? []).length === 0 ? (
                    <p className="text-xs" style={{ color: "var(--muted)" }}>No content in this collection.</p>
                  ) : (
                    <DataTable
                      rows={items ?? []}
                      rowKey={(item) => item.id}
                      columns={[
                        {
                          key: "title",
                          header: "Title",
                          render: (item) => (
                            <Link
                              href={`/new/content/${item.id}`}
                              className="text-sm hover:underline"
                            >
                              {item.title}
                            </Link>
                          ),
                        },
                        {
                          key: "kind",
                          header: "Kind",
                          render: (item) => (
                            <span className="text-xs font-mono" style={{ color: "var(--muted)" }}>
                              {item.kind}
                            </span>
                          ),
                        },
                      ]}
                    />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
