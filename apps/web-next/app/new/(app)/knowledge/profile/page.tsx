"use client";

import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import { TownApiError } from "@town/web-client";
import type { KnowledgeRevision, Profile } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";

export default function ProfilePage() {
  const client = useApiClient();
  const { mutate: globalMutate } = useSWRConfig();
  const {
    data: profile,
    error,
    isLoading,
  } = useSWR<Profile, TownApiError>("profile", () =>
    client.knowledge.profile.get(),
  );
  const { data: history } = useSWR<KnowledgeRevision[], TownApiError>(
    "profile:history",
    () => client.knowledge.profile.history(),
  );

  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const hasProfile = profile !== undefined;
  const isMissing = error !== undefined && error.status === 404;
  const profileRevision =
    profile === undefined ? null : profile.currentRevision;

  // Sync the editor with the loaded profile once per revision, unless the user
  // has unsaved edits.
  useEffect(() => {
    if (dirty) return;
    if (profile !== undefined) {
      setContent(JSON.stringify(profile.content, null, 2));
    }
  }, [profileRevision, dirty, profile]);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      setSaveError("Profile must be valid JSON.");
      setSaving(false);
      return;
    }
    if (
      parsed === null ||
      Array.isArray(parsed) ||
      typeof parsed !== "object"
    ) {
      setSaveError("Profile JSON must be an object.");
      setSaving(false);
      return;
    }
    const profileContent = parsed as Profile["content"];
    try {
      if (hasProfile && profile !== undefined) {
        const result = await client.knowledge.profile.update(
          profileContent,
          profile.currentRevision,
        );
        if (result.kind === "conflict") {
          throw new Error(
            "Profile changed elsewhere. Reload before saving again.",
          );
        }
      } else {
        await client.knowledge.profile.create(profileContent);
      }
      setDirty(false);
      await globalMutate("profile");
      await globalMutate("profile:history");
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Could not save profile.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <LoadingState label="Loading profile..." />;
  if (error !== undefined && !isMissing)
    return (
      <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
        {error.message}
      </p>
    );

  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Profile</h1>
        <span className="text-sm" style={{ color: "var(--muted)" }}>
          {hasProfile && profile !== undefined
            ? `Revision ${profile.currentRevision}`
            : "New profile"}
        </span>
      </div>

      <div className="mb-6 flex flex-col gap-2">
        <label className="text-sm" style={{ color: "var(--muted)" }}>
          Content (JSON object)
        </label>
        <textarea
          rows={12}
          value={content === "" && isMissing ? "{}" : content}
          onChange={(e) => {
            setContent(e.target.value);
            setDirty(true);
          }}
          spellCheck={false}
          className="rounded-lg border p-3 font-mono text-sm"
          style={{
            borderColor: "var(--panel-border)",
            background: "var(--panel)",
          }}
        />
        {saveError !== null && (
          <p
            className="text-sm"
            style={{ color: "var(--danger)" }}
            role="alert"
          >
            {saveError}
          </p>
        )}
        <div className="flex justify-end">
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
            {saving ? "Saving..." : "Save profile"}
          </button>
        </div>
      </div>

      <h2 className="mb-3 text-sm font-semibold">History</h2>
      {(history ?? []).length === 0 ? (
        <EmptyState title="No profile revisions yet." />
      ) : (
        <ul className="flex flex-col gap-2">
          {(history ?? []).map((rev) => (
            <li
              key={rev.id}
              className="rounded-lg border p-3"
              style={{
                background: "var(--panel)",
                borderColor: "var(--panel-border)",
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  Revision {rev.revision}
                </span>
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {rev.authorType} - {new Date(rev.createdAt).toLocaleString()}
                </span>
              </div>
              <details className="mt-2">
                <summary
                  className="cursor-pointer text-xs"
                  style={{ color: "var(--muted)" }}
                >
                  Snapshot
                </summary>
                <pre
                  className="mt-1 overflow-auto rounded-md p-2 text-xs"
                  style={{ background: "var(--background)" }}
                >
                  {JSON.stringify(rev.snapshot, null, 2)}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
