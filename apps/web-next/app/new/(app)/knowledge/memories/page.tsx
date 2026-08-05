"use client";

import { useState } from "react";
import useSWR from "swr";

import { TownApiError } from "@town/web-client";
import type { Memory, MemoryUpdateInput } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Drawer } from "@/components/drawer";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";

function confidenceLabel(value: number | null): string {
  return value === null ? "confidence not set" : `${Math.round(value * 100)}%`;
}

export default function MemoriesPage() {
  const client = useApiClient();
  const { data, error, isLoading, mutate } = useSWR<Memory[], TownApiError>(
    "memories",
    () => client.knowledge.memories.list(),
  );

  const [editing, setEditing] = useState<Memory | null>(null);
  const [content, setContent] = useState("");
  const [confidence, setConfidence] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [retireTarget, setRetireTarget] = useState<Memory | null>(null);

  function openEdit(memory: Memory) {
    setEditing(memory);
    setContent(memory.content);
    setConfidence(memory.confidence === null ? "" : String(memory.confidence));
    setSaveError(null);
  }

  async function handleSave() {
    if (editing === null) return;
    setSaving(true);
    setSaveError(null);
    try {
      const confidenceValue =
        confidence.trim() === "" ? undefined : Number(confidence);
      const base = {
        content: content.trim(),
        status: editing.status,
        expectedRevision: editing.currentRevision,
        ...(confidenceValue !== undefined
          ? { confidence: confidenceValue }
          : {}),
      };
      const input: MemoryUpdateInput =
        editing.scope === "routine" && editing.routineId !== null
          ? { ...base, scope: "routine", routineId: editing.routineId }
          : { ...base, scope: "global" };
      const result = await client.knowledge.memories.update(editing.id, input);
      if (result.kind === "conflict") {
        throw new Error(
          "Memory changed elsewhere. Reload before saving again.",
        );
      }
      setEditing(null);
      void mutate();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Could not save memory.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleRetire() {
    if (retireTarget === null) return;
    const target = retireTarget;
    try {
      await client.knowledge.memories.delete(target.id, target.currentRevision);
      setRetireTarget(null);
      void mutate();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Could not retire memory.",
      );
      setRetireTarget(null);
    }
  }

  const memories = (data ?? []).filter((m) => m.status === "active");

  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Memories</h1>
        <span className="text-sm" style={{ color: "var(--muted)" }}>
          {memories.length} active
        </span>
      </div>

      {isLoading ? (
        <LoadingState label="Loading memories..." />
      ) : error !== undefined ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error.message}
        </p>
      ) : memories.length === 0 ? (
        <EmptyState
          title="No active memories yet."
          hint="Memories capture durable facts about you."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {memories.map((memory) => (
            <li
              key={memory.id}
              className="flex flex-col gap-2 rounded-lg border p-4"
              style={{
                background: "var(--panel)",
                borderColor: "var(--panel-border)",
              }}
            >
              <p className="text-sm">{memory.content}</p>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                {memory.scope} - {confidenceLabel(memory.confidence)}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => openEdit(memory)}
                  className="rounded-md border px-3 py-1 text-xs transition-colors hover:bg-[color:var(--background)]"
                  style={{ borderColor: "var(--panel-border)" }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setRetireTarget(memory)}
                  className="rounded-md border px-3 py-1 text-xs transition-colors hover:bg-[color:var(--background)]"
                  style={{
                    borderColor: "var(--panel-border)",
                    color: "var(--danger)",
                  }}
                >
                  Retire
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit memory"
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
            Content
            <textarea
              rows={4}
              maxLength={50000}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="rounded-md border p-2"
              style={{
                borderColor: "var(--panel-border)",
                background: "var(--background)",
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Confidence (0-1)
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={confidence}
              onChange={(e) => setConfidence(e.target.value)}
              placeholder="Confidence"
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
        open={retireTarget !== null}
        title="Retire memory"
        message="Retiring marks this memory as retired. This cannot be undone from here."
        confirmLabel="Retire"
        destructive
        onConfirm={handleRetire}
        onCancel={() => setRetireTarget(null)}
      />
    </section>
  );
}
