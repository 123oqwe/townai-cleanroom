"use client";

import { use } from "react";
import useSWR from "swr";

import { TownApiError, type Channel } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { LoadingState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";

export default function ChannelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const client = useApiClient();
  const { data, error, isLoading } = useSWR<Channel, TownApiError>(
    ["channels", id],
    async () => {
      const all = await client.channels.list();
      const found = all.find((c) => c.id === id);
      if (found === undefined) throw new Error("Channel not found");
      return found;
    },
  );

  if (isLoading) return <LoadingState label="Loading channel..." />;
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
        Channel Details
      </h1>
      <div
        className="rounded-lg border p-4"
        style={{
          background: "var(--panel)",
          borderColor: "var(--panel-border)",
        }}
      >
        <div className="flex items-center justify-between">
          <strong className="text-sm">{data.kind}</strong>
          <StatusBadge status={data.status} />
        </div>
        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
          {data.address}
        </p>
        {Object.keys(data.config).length > 0 && (
          <pre
            className="mt-2 overflow-auto rounded-md p-2 text-xs"
            style={{ background: "var(--background)" }}
          >
            {JSON.stringify(data.config, null, 2)}
          </pre>
        )}
      </div>
    </section>
  );
}
