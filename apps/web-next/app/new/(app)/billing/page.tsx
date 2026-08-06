"use client";

import useSWR from "swr";

import { TownApiError, type BillingResponse } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";

export default function BillingPage() {
  const client = useApiClient();
  const { data, error, isLoading } = useSWR<BillingResponse, TownApiError>(
    ["billing"],
    () => client.billing.status(),
  );

  if (isLoading) return <LoadingState label="Loading billing..." />;
  if (error !== undefined)
    return (
      <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
        {error.message}
      </p>
    );
  if (data === undefined) return null;

  return (
    <section className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-xl font-semibold tracking-tight">Billing</h1>

      {data.status === "not_configured" ? (
        <EmptyState title="Billing is not configured for this workspace." />
      ) : (
        <>
          <div
            className="mb-6 rounded-lg border p-4"
            style={{
              background: "var(--panel)",
              borderColor: "var(--panel-border)",
            }}
          >
            <strong className="text-sm">{data.billing?.planName}</strong>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              {data.billing?.creditBand} -{" "}
              {data.billing?.isBlocked ? "blocked" : "available"}
            </p>
            {data.period && (
              <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                Period: {new Date(data.period.start).toLocaleDateString()} -{" "}
                {new Date(data.period.end).toLocaleDateString()}
              </p>
            )}
          </div>

          <h2 className="mb-3 text-sm font-medium">Usage</h2>
          {data.usage === undefined || data.usage.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              No usage recorded for this period.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {data.usage.map((item) => (
                <li
                  key={item.category}
                  className="flex items-center justify-between rounded-md border p-2 text-sm"
                  style={{ borderColor: "var(--panel-border)" }}
                >
                  <span>{item.category}</span>
                  <strong>
                    {item.quantity} {item.unit}
                  </strong>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
