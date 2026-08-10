"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ApiClientProvider } from "@/app/api-client";

type AuthState =
  | { status: "loading" }
  | { status: "authenticated" }
  | { status: "unauthenticated" };

async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setAuth({ status: "authenticated" });
        } else {
          setAuth({ status: "unauthenticated" });
        }
      })
      .catch(() => {
        if (!cancelled) setAuth({ status: "unauthenticated" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (auth.status === "loading")
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p style={{ color: "var(--muted)" }}>Loading…</p>
      </main>
    );

  if (auth.status === "unauthenticated") {
    void router.replace("/new/login");
    return null;
  }

  return (
    <ApiClientProvider>
      <div className="flex min-h-screen">
        <aside
          className="flex w-56 flex-col gap-1 border-r p-4"
          style={{
            background: "var(--panel)",
            borderColor: "var(--panel-border)",
          }}
        >
          <Link
            href="/new/threads"
            className="mb-4 text-lg font-semibold tracking-tight"
          >
            Town
          </Link>
          <nav className="flex flex-col gap-1 text-sm">
            <Link
              href="/new/threads"
              className="rounded-md px-3 py-2 transition-colors hover:bg-[color:var(--background)]"
            >
              Threads
            </Link>
          </nav>
          <nav className="flex flex-col gap-1 text-sm">
            <p
              className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--muted)" }}
            >
              Knowledge
            </p>
            <Link
              href="/new/knowledge/profile"
              className="rounded-md px-3 py-2 transition-colors hover:bg-[color:var(--background)]"
            >
              Profile
            </Link>
            <Link
              href="/new/knowledge/memories"
              className="rounded-md px-3 py-2 transition-colors hover:bg-[color:var(--background)]"
            >
              Memories
            </Link>
            <Link
              href="/new/knowledge/people"
              className="rounded-md px-3 py-2 transition-colors hover:bg-[color:var(--background)]"
            >
              People
            </Link>
            <Link
              href="/new/knowledge/wiki"
              className="rounded-md px-3 py-2 transition-colors hover:bg-[color:var(--background)]"
            >
              Wiki
            </Link>
            <Link
              href="/new/knowledge/search"
              className="rounded-md px-3 py-2 transition-colors hover:bg-[color:var(--background)]"
            >
              Search
            </Link>
            <Link
              href="/new/knowledge/conflicts"
              className="rounded-md px-3 py-2 transition-colors hover:bg-[color:var(--background)]"
            >
              Conflicts
            </Link>
          </nav>
          <nav className="flex flex-col gap-1 text-sm">
            <p
              className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--muted)" }}
            >
              Routines
            </p>
            <Link
              href="/new/routines"
              className="rounded-md px-3 py-2 transition-colors hover:bg-[color:var(--background)]"
            >
              All
            </Link>
            <Link
              href="/new/routines/templates"
              className="rounded-md px-3 py-2 transition-colors hover:bg-[color:var(--background)]"
            >
              Templates
            </Link>
          </nav>
          <nav className="flex flex-col gap-1 text-sm">
            <p
              className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--muted)" }}
            >
              Content
            </p>
            <Link
              href="/new/content"
              className="rounded-md px-3 py-2 transition-colors hover:bg-[color:var(--background)]"
            >
              Library
            </Link>
            <Link
              href="/new/content/collections"
              className="rounded-md px-3 py-2 transition-colors hover:bg-[color:var(--background)]"
            >
              Collections
            </Link>
            <Link
              href="/new/content/shares"
              className="rounded-md px-3 py-2 transition-colors hover:bg-[color:var(--background)]"
            >
              Shares
            </Link>
          </nav>
          <nav className="flex flex-col gap-1 text-sm">
            <p
              className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--muted)" }}
            >
              Tasks & Suggestions
            </p>
            <Link
              href="/new/tasks"
              className="rounded-md px-3 py-2 transition-colors hover:bg-[color:var(--background)]"
            >
              Tasks
            </Link>
            <Link
              href="/new/suggestions"
              className="rounded-md px-3 py-2 transition-colors hover:bg-[color:var(--background)]"
            >
              Suggestions
            </Link>
          </nav>
          <nav className="flex flex-col gap-1 text-sm">
            <Link
              href="/new/approvals"
              className="rounded-md px-3 py-2 transition-colors hover:bg-[color:var(--background)]"
            >
              Approvals
            </Link>
          </nav>
          <nav className="flex flex-col gap-1 text-sm">
            <p
              className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--muted)" }}
            >
              Account
            </p>
            <Link
              href="/new/sessions"
              className="rounded-md px-3 py-2 transition-colors hover:bg-[color:var(--background)]"
            >
              Sessions
            </Link>
          </nav>
          <nav className="flex flex-col gap-1 text-sm">
            <p
              className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--muted)" }}
            >
              Integrations
            </p>
            <Link
              href="/new/mcp"
              className="rounded-md px-3 py-2 transition-colors hover:bg-[color:var(--background)]"
            >
              MCP
            </Link>
            <Link
              href="/new/tools"
              className="rounded-md px-3 py-2 transition-colors hover:bg-[color:var(--background)]"
            >
              Tools
            </Link>
            <Link
              href="/new/channels"
              className="rounded-md px-3 py-2 transition-colors hover:bg-[color:var(--background)]"
            >
              Channels
            </Link>
            <Link
              href="/new/accounts"
              className="rounded-md px-3 py-2 transition-colors hover:bg-[color:var(--background)]"
            >
              Accounts
            </Link>
            <Link
              href="/new/voice"
              className="rounded-md px-3 py-2 transition-colors hover:bg-[color:var(--background)]"
            >
              Voice
            </Link>
          </nav>
          <nav className="flex flex-col gap-1 text-sm">
            <Link
              href="/new/billing"
              className="rounded-md px-3 py-2 transition-colors hover:bg-[color:var(--background)]"
            >
              Billing
            </Link>
          </nav>
          <nav className="flex flex-col gap-1 text-sm">
            <Link
              href="/new/squares"
              className="rounded-md px-3 py-2 transition-colors hover:bg-[color:var(--background)]"
            >
              Squares
            </Link>
          </nav>
          <nav className="flex flex-col gap-1 text-sm">
            <p
              className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--muted)" }}
            >
              Operations & Admin
            </p>
            <Link
              href="/new/operations"
              className="rounded-md px-3 py-2 transition-colors hover:bg-[color:var(--background)]"
            >
              Operations
            </Link>
            <Link
              href="/new/admin"
              className="rounded-md px-3 py-2 transition-colors hover:bg-[color:var(--background)]"
            >
              Admin
            </Link>
          </nav>
          <button
            type="button"
            onClick={async () => {
              await logout();
              void router.replace("/new/login");
            }}
            className="mt-auto rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-[color:var(--background)]"
            style={{ color: "var(--muted)" }}
          >
            Sign out
          </button>
        </aside>
        <div className="flex min-h-screen flex-1 flex-col">
          <header
            className="flex h-14 items-center border-b px-6"
            style={{ borderColor: "var(--panel-border)" }}
          >
            <span className="text-sm" style={{ color: "var(--muted)" }}>
              Workspace
            </span>
          </header>
          <div className="flex-1 overflow-auto p-6">{children}</div>
        </div>
      </div>
    </ApiClientProvider>
  );
}
