"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ApiClientProvider, TOWN_TOKEN_COOKIE } from "@/app/api-client";

function readToken(): string | null {
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${TOWN_TOKEN_COOKIE}=`));
  return match === undefined ? null : match.slice(TOWN_TOKEN_COOKIE.length + 1);
}

function logout() {
  document.cookie = `${TOWN_TOKEN_COOKIE}=; path=/; max-age=0`;
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setToken(readToken());
    setReady(true);
  }, []);

  if (!ready)
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p style={{ color: "var(--muted)" }}>Loading…</p>
      </main>
    );

  if (token === null) {
    void router.replace("/new/login");
    return null;
  }

  return (
    <ApiClientProvider token={token}>
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
          <button
            type="button"
            onClick={() => {
              logout();
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
