"use client";

import Link from "next/link";
import { use, useState } from "react";
import useSWR from "swr";

import { TownApiError } from "@town/web-client";
import type { Person, PersonRelationship } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Drawer } from "@/components/drawer";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";

const CATEGORIES = ["uncategorized", "coworker", "family", "personal"] as const;

export default function PersonDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const client = useApiClient();

  const {
    data: person,
    error,
    isLoading,
    mutate,
  } = useSWR<Person, TownApiError>(`person:${id}`, () =>
    client.knowledge.people.get(id as Person["id"]),
  );
  const { data: relationships, mutate: mutateRels } = useSWR<
    PersonRelationship[],
    TownApiError
  >(`person:${id}:relationships`, () =>
    client.knowledge.people.relationships(id as Person["id"]),
  );
  const { data: allPeople } = useSWR<Person[], TownApiError>("people", () =>
    client.knowledge.people.list(),
  );

  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [primaryEmail, setPrimaryEmail] = useState("");
  const [category, setCategory] = useState<string>("uncategorized");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [relType, setRelType] = useState("");
  const [relTarget, setRelTarget] = useState("");
  const [relNotes, setRelNotes] = useState("");
  const [relError, setRelError] = useState<string | null>(null);
  const [retireRel, setRetireRel] = useState<PersonRelationship | null>(null);

  function openEdit() {
    if (person === undefined) return;
    setDisplayName(person.displayName);
    setPrimaryEmail(person.primaryEmail ?? "");
    setCategory(person.category);
    setNotes(person.notes);
    setSaveError(null);
    setEditing(true);
  }

  async function handleSave() {
    if (person === undefined) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await client.knowledge.people.update(person.id, {
        displayName: displayName.trim(),
        ...(primaryEmail.trim() === ""
          ? {}
          : { primaryEmail: primaryEmail.trim() }),
        category: category as Person["category"],
        ...(person.organization !== null
          ? { organization: person.organization }
          : {}),
        ...(person.role !== null ? { role: person.role } : {}),
        notes,
        expectedRevision: person.currentRevision,
      });
      if (result.kind === "conflict") {
        throw new Error(
          "Person changed elsewhere. Reload before saving again.",
        );
      }
      setEditing(false);
      void mutate();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Could not save person.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleAddRelationship() {
    if (person === undefined) return;
    setRelError(null);
    try {
      await client.knowledge.people.addRelationship(person.id, {
        relatedPersonId: relTarget as Person["id"],
        relationshipType: relType.trim(),
        notes: relNotes,
      });
      setRelType("");
      setRelTarget("");
      setRelNotes("");
      void mutateRels();
    } catch (err) {
      setRelError(
        err instanceof Error ? err.message : "Could not add relationship.",
      );
    }
  }

  async function handleRetireRelationship() {
    if (retireRel === null) return;
    try {
      await client.knowledge.people.deleteRelationship(
        retireRel.id,
        retireRel.revision,
      );
      setRetireRel(null);
      void mutateRels();
    } catch (err) {
      setRelError(
        err instanceof Error ? err.message : "Could not archive relationship.",
      );
      setRetireRel(null);
    }
  }

  const candidateTargets = (allPeople ?? []).filter(
    (p) => p.status === "active" && p.id !== id,
  );

  if (isLoading) return <LoadingState label="Loading person..." />;
  if (error !== undefined)
    return (
      <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
        {error.message}
      </p>
    );
  if (person === undefined) return null;

  return (
    <section className="mx-auto max-w-3xl">
      <p className="mb-2 text-sm">
        <Link
          href="/new/knowledge/people"
          className="transition-colors hover:text-[color:var(--accent)]"
          style={{ color: "var(--muted)" }}
        >
          People
        </Link>
      </p>
      <div className="mb-6 flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">
            {person.displayName}
          </h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {person.primaryEmail ||
              person.organization ||
              person.role ||
              "No details yet"}
          </p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {person.category} - revision {person.currentRevision}
          </p>
        </div>
        <button
          type="button"
          onClick={openEdit}
          className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-[color:var(--background)]"
          style={{ borderColor: "var(--panel-border)" }}
        >
          Edit
        </button>
      </div>

      {person.notes !== "" && (
        <div
          className="mb-6 rounded-lg border p-4 text-sm"
          style={{
            background: "var(--panel)",
            borderColor: "var(--panel-border)",
          }}
        >
          <p style={{ color: "var(--muted)" }} className="mb-1 text-xs">
            Notes
          </p>
          <p>{person.notes}</p>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Relationships</h2>
      </div>
      <div
        className="mb-4 rounded-lg border p-4"
        style={{
          background: "var(--panel)",
          borderColor: "var(--panel-border)",
        }}
      >
        <div className="flex flex-col gap-2">
          <select
            value={relTarget}
            onChange={(e) => setRelTarget(e.target.value)}
            className="rounded-md border p-2 text-sm"
            style={{
              borderColor: "var(--panel-border)",
              background: "var(--background)",
            }}
          >
            <option value="">Choose a person...</option>
            {candidateTargets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
          <input
            value={relType}
            onChange={(e) => setRelType(e.target.value)}
            placeholder="Relationship type (e.g. mentor, collaborator)"
            className="rounded-md border p-2 text-sm"
            style={{
              borderColor: "var(--panel-border)",
              background: "var(--background)",
            }}
          />
          <input
            value={relNotes}
            onChange={(e) => setRelNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="rounded-md border p-2 text-sm"
            style={{
              borderColor: "var(--panel-border)",
              background: "var(--background)",
            }}
          />
          <button
            type="button"
            onClick={handleAddRelationship}
            disabled={relTarget === "" || relType.trim() === ""}
            className="self-start rounded-md px-3 py-1.5 text-sm font-medium transition-opacity disabled:opacity-60"
            style={{
              background: "var(--accent)",
              color: "var(--accent-foreground)",
            }}
          >
            Add relationship
          </button>
          {relError !== null && (
            <p
              className="text-sm"
              style={{ color: "var(--danger)" }}
              role="alert"
            >
              {relError}
            </p>
          )}
        </div>
      </div>

      {(relationships ?? []).length === 0 ? (
        <EmptyState title="No relationships recorded yet." />
      ) : (
        <ul className="flex flex-col gap-2">
          {(relationships ?? []).map((rel) => {
            const target = (allPeople ?? []).find(
              (p) => p.id === rel.relatedPersonId,
            );
            return (
              <li
                key={rel.id}
                className="flex items-center justify-between rounded-lg border p-3"
                style={{
                  background: "var(--panel)",
                  borderColor: "var(--panel-border)",
                }}
              >
                <div className="flex flex-col">
                  <span className="text-sm font-medium">
                    {target?.displayName ?? rel.relatedPersonId.slice(0, 8)}
                  </span>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    {rel.relationshipType}
                    {rel.notes !== "" ? ` - ${rel.notes}` : ""}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setRetireRel(rel)}
                  className="rounded-md border px-2 py-1 text-xs transition-colors hover:bg-[color:var(--background)]"
                  style={{
                    borderColor: "var(--panel-border)",
                    color: "var(--danger)",
                  }}
                >
                  Archive
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Drawer
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit person"
        footer={
          <>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-[color:var(--background)]"
              style={{ color: "var(--muted)" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
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
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
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
              value={primaryEmail}
              onChange={(e) => setPrimaryEmail(e.target.value)}
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

      <ConfirmDialog
        open={retireRel !== null}
        title="Archive relationship"
        message="This relationship will be archived."
        confirmLabel="Archive"
        destructive
        onConfirm={handleRetireRelationship}
        onCancel={() => setRetireRel(null)}
      />
    </section>
  );
}
