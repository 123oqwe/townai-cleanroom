"use client";

import { useEffect, useState } from "react";

interface SessionDetail {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  authMethod: string | null;
  isCurrent: boolean;
  deviceLabel: string | null;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/sessions")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((body: { sessions: SessionDetail[] }) => {
        setSessions(body.sessions);
        setLoading(false);
      })
      .catch(() => {
        setError("Could not load sessions.");
        setLoading(false);
      });
  }, []);

  async function revoke(id: string) {
    const response = await fetch(`/api/auth/sessions?id=${id}`, {
      method: "DELETE",
    });
    if (response.ok) {
      setSessions((prev) => prev.filter((s) => s.id !== id));
    }
  }

  async function revokeAll() {
    const response = await fetch("/api/auth/logout-all", { method: "POST" });
    if (response.ok) {
      window.location.href = "/new/login";
    }
  }

  if (loading) {
    return (
      <main className="p-6">
        <p style={{ color: "var(--muted)" }}>Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-xl font-semibold tracking-tight">Sessions</h1>
      {error !== null && (
        <p
          className="mb-4 text-sm"
          style={{ color: "var(--danger)" }}
          role="alert"
        >
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {sessions.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between rounded-md border p-3"
            style={{ borderColor: "var(--panel-border)" }}
          >
            <div className="flex flex-col gap-1 text-sm">
              <span>
                {s.isCurrent ? "This device" : "Another device"}
                {s.deviceLabel !== null ? ` · ${s.deviceLabel}` : ""}
              </span>
              <span style={{ color: "var(--muted)" }}>
                Created {new Date(s.createdAt).toLocaleString()}
              </span>
              <span style={{ color: "var(--muted)" }}>
                Last active {new Date(s.lastSeenAt).toLocaleString()}
              </span>
              <span style={{ color: "var(--muted)" }}>
                Expires {new Date(s.expiresAt).toLocaleString()}
              </span>
            </div>
            {!s.isCurrent && (
              <button
                type="button"
                onClick={() => void revoke(s.id)}
                className="rounded-md border px-3 py-1 text-sm"
                style={{ borderColor: "var(--panel-border)" }}
              >
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => void revokeAll()}
        className="mt-6 rounded-md px-4 py-2 text-sm font-medium"
        style={{
          background: "var(--danger)",
          color: "var(--accent-foreground)",
        }}
      >
        Sign out all sessions
      </button>
    </main>
  );
}
