"use client";

import { useState } from "react";
import useSWR from "swr";

import { TownApiError, type McpServer } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";

export default function McpPage() {
  const client = useApiClient();
  const { data: serversData, error, isLoading, mutate } = useSWR<McpServer[], TownApiError>(
    ["mcp-servers"],
    () => client.mcp.servers.list(),
  );

  const servers = serversData ?? [];
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [transport, setTransport] = useState<"stdio" | "sse" | "streamable_http">("sse");
  const [authRef, setAuthRef] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (name.trim() === "" || url.trim() === "") return;
    setSaving(true);
    try {
      await client.mcp.servers.create({
        name: name.trim(),
        url: url.trim(),
        transport,
        ...(authRef.trim() === "" ? {} : { authRef: authRef.trim() }),
      });
      setName("");
      setUrl("");
      setAuthRef("");
      void mutate();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(server: McpServer) {
    await client.mcp.servers.delete(server.id, server.revision);
    void mutate();
  }

  return (
    <section className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-xl font-semibold tracking-tight">MCP Servers</h1>

      <div className="mb-6 rounded-lg border p-4" style={{ background: "var(--panel)", borderColor: "var(--panel-border)" }}>
        <h2 className="mb-3 text-sm font-medium">Add Server</h2>
        <div className="flex flex-col gap-2">
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border p-2 text-sm"
            style={{ borderColor: "var(--panel-border)", background: "var(--background)" }}
          />
          <input
            type="text"
            placeholder="URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="rounded-md border p-2 text-sm"
            style={{ borderColor: "var(--panel-border)", background: "var(--background)" }}
          />
          <select
            value={transport}
            onChange={(e) => setTransport(e.target.value as typeof transport)}
            className="rounded-md border p-2 text-sm"
            style={{ borderColor: "var(--panel-border)", background: "var(--background)" }}
          >
            <option value="sse">SSE</option>
            <option value="stdio">Stdio</option>
            <option value="streamable_http">Streamable HTTP</option>
          </select>
          <input
            type="text"
            placeholder="Auth reference (optional)"
            value={authRef}
            onChange={(e) => setAuthRef(e.target.value)}
            className="rounded-md border p-2 text-sm"
            style={{ borderColor: "var(--panel-border)", background: "var(--background)" }}
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving}
            className="rounded-md px-3 py-2 text-sm font-medium transition-opacity disabled:opacity-60"
            style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}
          >
            {saving ? "Saving..." : "Add Server"}
          </button>
        </div>
      </div>

      {isLoading ? (
        <LoadingState label="Loading MCP servers..." />
      ) : error !== undefined ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error.message}
        </p>
      ) : servers.length === 0 ? (
        <EmptyState title="No MCP servers configured." hint="Add a server to connect external tools." />
      ) : (
        <ul className="flex flex-col gap-2">
          {servers.map((server) => (
            <li
              key={server.id}
              className="rounded-lg border p-4"
              style={{ background: "var(--panel)", borderColor: "var(--panel-border)" }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <strong className="text-sm">{server.name}</strong>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>{server.url}</p>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    {server.transport} - auth {server.authRef ? "configured" : "not configured"}
                  </p>
                </div>
                <StatusBadge status={server.status} />
              </div>
              {server.status === "active" && (
                <button
                  type="button"
                  onClick={() => handleDelete(server)}
                  className="mt-2 rounded-md border px-2 py-1 text-xs transition-colors"
                  style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
                >
                  Disable
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
