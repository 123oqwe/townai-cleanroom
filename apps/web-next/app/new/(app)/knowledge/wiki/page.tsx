"use client";

import { useState } from "react";
import useSWR from "swr";

import { TownApiError } from "@town/web-client";
import type {
  KnowledgeRevision,
  WikiDocument,
  WikiKind,
} from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { Drawer } from "@/components/drawer";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";

const KINDS: WikiKind[] = ["profile", "goal", "project", "page"];

function snapshotField(
  snapshot: Record<string, unknown>,
  field: string,
): string {
  const value = snapshot[field];
  return typeof value === "string" ? value : "";
}

export default function WikiPage() {
  const client = useApiClient();
  const { data, error, isLoading, mutate } = useSWR<
    WikiDocument[],
    TownApiError
  >("wiki", () => client.knowledge.wiki.list());

  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState<WikiKind>("page");
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<WikiDocument | null>(null);
  const [editSlug, setEditSlug] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const [historyFor, setHistoryFor] = useState<WikiDocument | null>(null);
  const { data: history, isLoading: historyLoading } = useSWR<
    KnowledgeRevision[],
    TownApiError
  >(historyFor === null ? null : `wiki:${historyFor.id}:revisions`, () =>
    historyFor === null
      ? Promise.reject(new Error("No wiki document selected."))
      : client.knowledge.wiki.history(historyFor.id),
  );

  async function handleCreate() {
    setSaving(true);
    setSaveError(null);
    try {
      await client.knowledge.wiki.create({
        kind,
        slug: slug.trim(),
        title: title.trim(),
        body,
      });
      setCreating(false);
      setSlug("");
      setTitle("");
      setBody("");
      void mutate();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Could not save Wiki page.",
      );
    } finally {
      setSaving(false);
    }
  }

  function openEdit(doc: WikiDocument) {
    setEditing(doc);
    setEditSlug(doc.slug);
    setEditTitle(doc.title);
    setEditBody(doc.body);
    setEditError(null);
  }

  async function handleSaveEdit() {
    if (editing === null) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const result = await client.knowledge.wiki.update(editing.id, {
        kind: editing.kind,
        slug: editSlug.trim(),
        title: editTitle.trim(),
        body: editBody,
        expectedRevision: editing.currentRevision,
      });
      if (result.kind === "conflict") {
        throw new Error(
          "Wiki page changed elsewhere. Reload before saving again.",
        );
      }
      setEditing(null);
      void mutate();
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : "Could not save Wiki page.",
      );
    } finally {
      setEditSaving(false);
    }
  }

  const documents = (data ?? []).filter((d) => d.status === "active");

  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Wiki</h1>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-md px-3 py-1.5 text-sm font-medium transition-opacity"
          style={{
            background: "var(--accent)",
            color: "var(--accent-foreground)",
          }}
        >
          New page
        </button>
      </div>

      {isLoading ? (
        <LoadingState label="Loading wiki..." />
      ) : error !== undefined ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error.message}
        </p>
      ) : documents.length === 0 ? (
        <EmptyState title="No Wiki pages yet." />
      ) : (
        <ul className="flex flex-col gap-2">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="rounded-lg border p-4"
              style={{
                background: "var(--panel)",
                borderColor: "var(--panel-border)",
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded px-1.5 py-0.5 text-xs"
                      style={{
                        background: "var(--background)",
                        color: "var(--muted)",
                      }}
                    >
                      {doc.kind}
                    </span>
                    <span className="font-medium">{doc.title}</span>
                  </div>
                  <p className="text-sm">{doc.body}</p>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    {doc.slug} - revision {doc.currentRevision}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => openEdit(doc)}
                  className="rounded-md border px-3 py-1 text-xs transition-colors hover:bg-[color:var(--background)]"
                  style={{ borderColor: "var(--panel-border)" }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryFor(doc)}
                  className="rounded-md border px-3 py-1 text-xs transition-colors hover:bg-[color:var(--background)]"
                  style={{ borderColor: "var(--panel-border)" }}
                >
                  History
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Drawer
        open={creating}
        onClose={() => setCreating(false)}
        title="New wiki page"
        footer={
          <>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-[color:var(--background)]"
              style={{ color: "var(--muted)" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={saving || slug.trim() === "" || title.trim() === ""}
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
        <WikiForm
          kind={kind}
          setKind={setKind}
          slug={slug}
          setSlug={setSlug}
          title={title}
          setTitle={setTitle}
          body={body}
          setBody={setBody}
          error={saveError}
        />
      </Drawer>

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit wiki page"
        footer={
          <>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-[color:var(--background)]"
              style={{ color: "var(--muted)" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveEdit}
              disabled={editSaving}
              className="rounded-md px-3 py-1.5 text-sm font-medium transition-opacity disabled:opacity-60"
              style={{
                background: "var(--accent)",
                color: "var(--accent-foreground)",
              }}
            >
              {editSaving ? "Saving..." : "Save"}
            </button>
          </>
        }
      >
        <WikiForm
          kind={editing?.kind ?? "page"}
          setKind={() => {}}
          slug={editSlug}
          setSlug={setEditSlug}
          title={editTitle}
          setTitle={setEditTitle}
          body={editBody}
          setBody={setEditBody}
          error={editError}
          kindDisabled
        />
      </Drawer>

      <Drawer
        open={historyFor !== null}
        onClose={() => setHistoryFor(null)}
        title={`History - ${historyFor?.title ?? ""}`}
      >
        {historyLoading ? (
          <LoadingState label="Loading history..." />
        ) : (history ?? []).length === 0 ? (
          <EmptyState title="No revisions yet." />
        ) : (
          <ul className="flex flex-col gap-3">
            {(history ?? []).map((rev) => (
              <li
                key={rev.id}
                className="rounded-lg border p-3"
                style={{ borderColor: "var(--panel-border)" }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    Revision {rev.revision}
                  </span>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    {rev.authorType} -{" "}
                    {new Date(rev.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 text-sm">
                  {snapshotField(rev.snapshot, "title") || "(no title)"}
                </p>
                <pre
                  className="mt-1 overflow-auto rounded-md p-2 text-xs"
                  style={{ background: "var(--background)" }}
                >
                  {snapshotField(rev.snapshot, "body") ||
                    JSON.stringify(rev.snapshot, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </Drawer>
    </section>
  );
}

function WikiForm({
  kind,
  setKind,
  slug,
  setSlug,
  title,
  setTitle,
  body,
  setBody,
  error,
  kindDisabled = false,
}: {
  kind: WikiKind;
  setKind: (k: WikiKind) => void;
  slug: string;
  setSlug: (s: string) => void;
  title: string;
  setTitle: (s: string) => void;
  body: string;
  setBody: (s: string) => void;
  error: string | null;
  kindDisabled?: boolean;
}) {
  const inputStyle = {
    borderColor: "var(--panel-border)",
    background: "var(--background)",
  } as const;
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Kind
        <select
          value={kind}
          disabled={kindDisabled}
          onChange={(e) => setKind(e.target.value as WikiKind)}
          className="rounded-md border p-2"
          style={inputStyle}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Slug
        <input
          maxLength={200}
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          className="rounded-md border p-2"
          style={inputStyle}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Title
        <input
          maxLength={500}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="rounded-md border p-2"
          style={inputStyle}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Body
        <textarea
          rows={6}
          maxLength={200000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="rounded-md border p-2"
          style={inputStyle}
        />
      </label>
      {error !== null && (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
