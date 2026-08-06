"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";

import { TownApiError, type Square } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";

export default function SquaresPage() {
  const client = useApiClient();
  const { data, error, isLoading, mutate } = useSWR<Square[], TownApiError>(
    ["squares"],
    () => client.squares.list(),
  );

  const squares = data ?? [];
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (name.trim() === "" || slug.trim() === "") return;
    setSaving(true);
    try {
      await client.squares.create({
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim(),
      });
      setName("");
      setSlug("");
      setDescription("");
      void mutate();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-xl font-semibold tracking-tight">Squares</h1>

      <div
        className="mb-6 rounded-lg border p-4"
        style={{
          background: "var(--panel)",
          borderColor: "var(--panel-border)",
        }}
      >
        <h2 className="mb-3 text-sm font-medium">Create Square</h2>
        <div className="flex flex-col gap-2">
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border p-2 text-sm"
            style={{
              borderColor: "var(--panel-border)",
              background: "var(--background)",
            }}
          />
          <input
            type="text"
            placeholder="Slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="rounded-md border p-2 text-sm"
            style={{
              borderColor: "var(--panel-border)",
              background: "var(--background)",
            }}
          />
          <input
            type="text"
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="rounded-md border p-2 text-sm"
            style={{
              borderColor: "var(--panel-border)",
              background: "var(--background)",
            }}
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving}
            className="rounded-md px-3 py-2 text-sm font-medium transition-opacity disabled:opacity-60"
            style={{
              background: "var(--accent)",
              color: "var(--accent-foreground)",
            }}
          >
            {saving ? "..." : "Create"}
          </button>
        </div>
      </div>

      {isLoading ? (
        <LoadingState label="Loading squares..." />
      ) : error !== undefined ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error.message}
        </p>
      ) : squares.length === 0 ? (
        <EmptyState
          title="No active Squares yet."
          hint="Create a Square to share accounts and collaborate."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {squares.map((sq) => (
            <li key={sq.id}>
              <Link
                href={`/new/squares/${sq.id}`}
                className="block rounded-lg border p-4 transition-colors hover:bg-[color:var(--background)]"
                style={{
                  background: "var(--panel)",
                  borderColor: "var(--panel-border)",
                }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <strong className="text-sm">{sq.name}</strong>
                    <p className="text-xs" style={{ color: "var(--muted)" }}>
                      {sq.description || "No description"}
                    </p>
                    <p className="text-xs" style={{ color: "var(--muted)" }}>
                      {sq.slug} - {sq.membership.role}
                    </p>
                  </div>
                  <StatusBadge status={sq.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
