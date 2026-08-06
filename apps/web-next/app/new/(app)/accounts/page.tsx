"use client";

import useSWR from "swr";
import Link from "next/link";

import { TownApiError, type ConnectedAccount } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";

export default function AccountsPage() {
  const client = useApiClient();
  const { data, error, isLoading, mutate } = useSWR<
    ConnectedAccount[],
    TownApiError
  >(["accounts"], () => client.accounts.list());

  const accounts = data ?? [];

  async function handleGoogleConnect() {
    try {
      const url = await client.accounts.google.oauth.start();
      window.location.href = url;
    } catch {
      // ignore
    }
  }

  async function handleRefresh(id: ConnectedAccount["id"]) {
    await client.accounts.refresh(id as ConnectedAccount["id"]);
    void mutate();
  }

  async function handleDelete(id: ConnectedAccount["id"]) {
    await client.accounts.delete(id as ConnectedAccount["id"]);
    void mutate();
  }

  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">
          Connected Accounts
        </h1>
        <button
          type="button"
          onClick={handleGoogleConnect}
          className="rounded-md px-3 py-1.5 text-sm font-medium"
          style={{
            background: "var(--accent)",
            color: "var(--accent-foreground)",
          }}
        >
          Connect Google
        </button>
      </div>

      {isLoading ? (
        <LoadingState label="Loading accounts..." />
      ) : error !== undefined ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error.message}
        </p>
      ) : accounts.length === 0 ? (
        <EmptyState
          title="No connected accounts yet."
          hint="Connect a Google account to enable email and calendar routines."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {accounts.map((account) => (
            <li key={account.id}>
              <Link
                href={`/new/accounts/${account.id}`}
                className="block rounded-lg border p-4 transition-colors hover:bg-[color:var(--background)]"
                style={{
                  background: "var(--panel)",
                  borderColor: "var(--panel-border)",
                }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <strong className="text-sm">{account.provider}</strong>
                    <p className="text-xs" style={{ color: "var(--muted)" }}>
                      {account.email}
                    </p>
                    <p className="text-xs" style={{ color: "var(--muted)" }}>
                      {Object.entries(account.capabilities)
                        .filter(([, v]) => v)
                        .map(([k]) => k)
                        .join(" - ") || "No capabilities"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs"
                      style={{
                        color: account.needsReauth
                          ? "var(--danger)"
                          : "var(--muted)",
                      }}
                    >
                      {account.needsReauth
                        ? "reauth"
                        : account.isActive
                          ? "active"
                          : "inactive"}
                    </span>
                    {account.provider === "google" && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          handleRefresh(account.id);
                        }}
                        className="rounded-md border px-2 py-1 text-xs"
                        style={{ borderColor: "var(--panel-border)" }}
                      >
                        Refresh
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        handleDelete(account.id);
                      }}
                      className="rounded-md border px-2 py-1 text-xs"
                      style={{
                        borderColor: "var(--danger)",
                        color: "var(--danger)",
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
