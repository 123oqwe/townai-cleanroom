"use client";

import useSWR from "swr";

import { TownApiError, type ScheduleResult } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";

export default function SchedulePage() {
  const client = useApiClient();
  const { data, error, isLoading } = useSWR<ScheduleResult, TownApiError>(
    ["schedule"],
    () => client.operations.schedule({ limit: 12 }),
  );

  const items = data?.items ?? [];
  const calendars = data?.calendars ?? [];

  return (
    <section className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-xl font-semibold tracking-tight">Schedule</h1>

      {calendars.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {calendars.map((cal) => (
            <span
              key={cal.id}
              className="rounded-full px-2 py-0.5 text-xs"
              style={{ background: "var(--panel)", color: "var(--muted)" }}
            >
              {cal.name}
            </span>
          ))}
        </div>
      )}

      {isLoading ? (
        <LoadingState label="Loading schedule..." />
      ) : error !== undefined ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error.message}
        </p>
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing scheduled."
          hint="Connect a calendar to see upcoming events."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-lg border p-3"
              style={{
                background: "var(--panel)",
                borderColor: "var(--panel-border)",
              }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    {item.kind}
                  </span>
                  <strong className="block text-sm">{item.title}</strong>
                </div>
                <time className="text-xs" style={{ color: "var(--muted)" }}>
                  {new Date(item.startAt).toLocaleString()}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
