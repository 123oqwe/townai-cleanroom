"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";

import { TownApiError } from "@town/web-client";
import type { Person } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { Drawer } from "@/components/drawer";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";

const CATEGORIES = ["uncategorized", "coworker", "family", "personal"] as const;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function PeoplePage() {
  const client = useApiClient();
  const { data, error, isLoading, mutate } = useSWR<Person[], TownApiError>(
    "people",
    () => client.knowledge.people.list(),
  );

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState<string>("uncategorized");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleCreate() {
    setSaving(true);
    setSaveError(null);
    try {
      await client.knowledge.people.create({
        displayName: name.trim(),
        ...(email.trim() === "" ? {} : { primaryEmail: email.trim() }),
        category: category as Person["category"],
        notes,
      });
      setAdding(false);
      setName("");
      setEmail("");
      setNotes("");
      void mutate();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Could not save person.",
      );
    } finally {
      setSaving(false);
    }
  }

  const people = (data ?? []).filter((p) => p.status === "active");

  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">People</h1>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-md px-3 py-1.5 text-sm font-medium transition-opacity"
          style={{
            background: "var(--accent)",
            color: "var(--accent-foreground)",
          }}
        >
          Add person
        </button>
      </div>

      {isLoading ? (
        <LoadingState label="Loading people..." />
      ) : error !== undefined ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error.message}
        </p>
      ) : people.length === 0 ? (
        <EmptyState
          title="No people saved yet."
          hint="Add the first one when you are ready."
          action={
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="rounded-md px-3 py-1.5 text-sm font-medium"
              style={{
                background: "var(--accent)",
                color: "var(--accent-foreground)",
              }}
            >
              Add person
            </button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {people.map((person) => (
            <li key={person.id}>
              <Link
                href={`/new/knowledge/people/${person.id}`}
                className="flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors hover:border-[color:var(--accent)]"
                style={{
                  background: "var(--panel)",
                  borderColor: "var(--panel-border)",
                }}
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                  style={{
                    background: "var(--background)",
                    color: "var(--muted)",
                  }}
                >
                  {initials(person.displayName)}
                </span>
                <span className="flex flex-1 flex-col">
                  <span className="font-medium">{person.displayName}</span>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    {person.primaryEmail ||
                      person.organization ||
                      person.role ||
                      "No details yet"}
                  </span>
                </span>
                <span
                  className="rounded-full px-2 py-0.5 text-xs"
                  style={{
                    background: "var(--background)",
                    color: "var(--muted)",
                  }}
                >
                  {person.category}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Drawer
        open={adding}
        onClose={() => setAdding(false)}
        title="Add person"
        footer={
          <>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-[color:var(--background)]"
              style={{ color: "var(--muted)" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={saving || name.trim() === ""}
              className="rounded-md px-3 py-1.5 text-sm font-medium transition-opacity disabled:opacity-60"
              style={{
                background: "var(--accent)",
                color: "var(--accent-foreground)",
              }}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Display name
            <input
              maxLength={200}
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
            Email
            <input
              type="email"
              maxLength={320}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border p-2"
              style={{
                borderColor: "var(--panel-border)",
                background: "var(--background)",
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-md border p-2"
              style={{
                borderColor: "var(--panel-border)",
                background: "var(--background)",
              }}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Notes
            <textarea
              rows={3}
              maxLength={10000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="rounded-md border p-2"
              style={{
                borderColor: "var(--panel-border)",
                background: "var(--background)",
              }}
            />
          </label>
          {saveError !== null && (
            <p
              className="text-sm"
              style={{ color: "var(--danger)" }}
              role="alert"
            >
              {saveError}
            </p>
          )}
        </div>
      </Drawer>
    </section>
  );
}
