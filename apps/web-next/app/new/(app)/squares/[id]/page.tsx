"use client";

import { use } from "react";
import useSWR from "swr";

import {
  TownApiError,
  type Square,
  type SquareMember,
  type SquarePolicy,
} from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { LoadingState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";

export default function SquareDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const client = useApiClient();

  const {
    data: square,
    error: sqError,
    isLoading: sqLoading,
  } = useSWR<Square, TownApiError>(["squares", id], () =>
    client.squares.get(id as Square["id"]),
  );

  const { data: members, error: memError } = useSWR<
    SquareMember[],
    TownApiError
  >(["squares", id, "members"], () =>
    client.squares.members.list(id as Square["id"]),
  );

  const { data: policy, error: polError } = useSWR<SquarePolicy, TownApiError>(
    ["squares", id, "policy"],
    () => client.squares.policy.get(id as Square["id"]),
  );

  const { data: accountShares } = useSWR(["squares", id, "accounts"], () =>
    client.squares.accounts.list(id as Square["id"]),
  );

  const loading = sqLoading;
  const error = sqError ?? memError ?? polError;

  if (loading) return <LoadingState label="Loading square..." />;
  if (error !== undefined)
    return (
      <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
        {error.message}
      </p>
    );
  if (square === undefined) return null;

  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">{square.name}</h1>
        <StatusBadge status={square.status} />
      </div>
      <p className="mb-6 text-sm" style={{ color: "var(--muted)" }}>
        {square.description}
      </p>

      <h2 className="mb-3 text-sm font-medium">Members</h2>
      {members === undefined || members.length === 0 ? (
        <p className="mb-6 text-sm" style={{ color: "var(--muted)" }}>
          No members.
        </p>
      ) : (
        <ul className="mb-6 flex flex-col gap-1">
          {members.map((m) => (
            <li
              key={m.userId}
              className="flex items-center justify-between rounded-md border p-2 text-sm"
              style={{ borderColor: "var(--panel-border)" }}
            >
              <span>{m.userId.slice(0, 8)}</span>
              <span style={{ color: "var(--muted)" }}>
                {m.role} - {m.status}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mb-3 text-sm font-medium">Policy</h2>
      {policy === undefined ? (
        <p className="mb-6 text-sm" style={{ color: "var(--muted)" }}>
          No policy configured.
        </p>
      ) : (
        <div
          className="mb-6 rounded-lg border p-4"
          style={{
            background: "var(--panel)",
            borderColor: "var(--panel-border)",
          }}
        >
          <p className="text-sm">
            Default mode: <strong>{policy.defaultMode}</strong>
          </p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Allowed tools: {policy.allowedToolNames.join(", ") || "none"}
          </p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Allowed domains: {policy.allowedDomains.join(", ") || "none"}
          </p>
        </div>
      )}

      <h2 className="mb-3 text-sm font-medium">Shared Accounts</h2>
      {accountShares === undefined || accountShares.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          No shared accounts.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {accountShares.map((share) => (
            <li
              key={share.id}
              className="flex items-center justify-between rounded-md border p-2 text-sm"
              style={{ borderColor: "var(--panel-border)" }}
            >
              <div>
                <strong>{share.provider}</strong>
                <span style={{ color: "var(--muted)" }}> - {share.email}</span>
              </div>
              <span style={{ color: "var(--muted)" }}>
                {share.capabilities.join(", ") || "none"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
