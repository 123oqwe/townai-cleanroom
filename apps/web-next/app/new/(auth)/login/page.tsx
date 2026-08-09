"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (response.ok) {
        router.replace("/new/threads");
        return;
      }
      const body = (await response.json()) as {
        code?: string;
        detail?: string;
      };
      if (response.status === 403)
        setError("This email is not on the allowlist.");
      else if (response.status === 429)
        setError("Too many attempts. Please slow down and retry.");
      else setError(body.detail ?? "Could not sign in.");
      setSubmitting(false);
    } catch {
      setError("Could not connect to the API.");
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <div
        className="rounded-lg border p-8"
        style={{
          background: "var(--panel)",
          borderColor: "var(--panel-border)",
        }}
      >
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Town</h1>
        <p className="mb-6 text-sm" style={{ color: "var(--muted)" }}>
          Sign in to your workspace
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span style={{ color: "var(--muted)" }}>Email</span>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              placeholder="you@example.com"
              className="rounded-md border px-3 py-2 outline-none focus:border-[color:var(--accent)]"
              style={{
                background: "var(--background)",
                borderColor: "var(--panel-border)",
              }}
            />
          </label>
          {error !== null && (
            <p
              className="text-sm"
              style={{ color: "var(--danger)" }}
              role="alert"
            >
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="mt-2 rounded-md px-4 py-2 font-medium transition-opacity disabled:opacity-60"
            style={{
              background: "var(--accent)",
              color: "var(--accent-foreground)",
            }}
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
