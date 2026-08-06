"use client";

import { use, useState } from "react";
import useSWR from "swr";

import { TownApiError, type ConnectedAccount } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { LoadingState } from "@/components/states";

export default function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const client = useApiClient();
  const { data, error, isLoading } = useSWR<ConnectedAccount, TownApiError>(
    ["accounts", id],
    async () => {
      const all = await client.accounts.list();
      const found = all.find((a) => a.id === id);
      if (found === undefined) throw new Error("Account not found");
      return found;
    },
  );

  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [scopes, setScopes] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSaveCredential() {
    if (accessToken.trim() === "") return;
    setSaving(true);
    try {
      await client.accounts.updateCredential(id as ConnectedAccount["id"], {
        accessToken: accessToken.trim(),
        ...(refreshToken.trim() === ""
          ? {}
          : { refreshToken: refreshToken.trim() }),
        ...(scopes.trim() === ""
          ? {}
          : {
              scopes: scopes
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            }),
      });
      setAccessToken("");
      setRefreshToken("");
      setScopes("");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <LoadingState label="Loading account..." />;
  if (error !== undefined)
    return (
      <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
        {error.message}
      </p>
    );
  if (data === undefined) return null;

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-xl font-semibold tracking-tight">
        Account Details
      </h1>
      <div
        className="rounded-lg border p-4"
        style={{
          background: "var(--panel)",
          borderColor: "var(--panel-border)",
        }}
      >
        <strong className="text-sm">{data.provider}</strong>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {data.email}
        </p>
        <p
          className="text-xs"
          style={{ color: data.needsReauth ? "var(--danger)" : "var(--muted)" }}
        >
          {data.needsReauth
            ? "Needs reauth"
            : data.isActive
              ? "Active"
              : "Inactive"}
        </p>
        <div className="mt-2">
          <p className="text-xs font-medium">Capabilities:</p>
          <ul className="text-xs" style={{ color: "var(--muted)" }}>
            {Object.entries(data.capabilities).map(([key, val]) => (
              <li key={key}>
                {key}: {val ? "yes" : "no"}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div
        className="mt-4 rounded-lg border p-4"
        style={{
          background: "var(--panel)",
          borderColor: "var(--panel-border)",
        }}
      >
        <h2 className="mb-3 text-sm font-medium">Rotate Credential</h2>
        <div className="flex flex-col gap-2">
          <input
            type="password"
            placeholder="Access token"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            className="rounded-md border p-2 text-sm"
            style={{
              borderColor: "var(--panel-border)",
              background: "var(--background)",
            }}
          />
          <input
            type="password"
            placeholder="Refresh token (optional)"
            value={refreshToken}
            onChange={(e) => setRefreshToken(e.target.value)}
            className="rounded-md border p-2 text-sm"
            style={{
              borderColor: "var(--panel-border)",
              background: "var(--background)",
            }}
          />
          <input
            type="text"
            placeholder="Scopes (comma-separated)"
            value={scopes}
            onChange={(e) => setScopes(e.target.value)}
            className="rounded-md border p-2 text-sm"
            style={{
              borderColor: "var(--panel-border)",
              background: "var(--background)",
            }}
          />
          <button
            type="button"
            onClick={handleSaveCredential}
            disabled={saving}
            className="rounded-md px-3 py-2 text-sm font-medium transition-opacity disabled:opacity-60"
            style={{
              background: "var(--accent)",
              color: "var(--accent-foreground)",
            }}
          >
            {saving ? "Saving..." : "Save Credential"}
          </button>
        </div>
      </div>
    </section>
  );
}
