"use client";

import { useState } from "react";
import useSWR from "swr";

import { TownApiError, type Channel, type DeliveryPage, type TimelinePage } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import Link from "next/link";

export default function ChannelsPage() {
  const client = useApiClient();
  const { data: channelsData, error, isLoading, mutate } = useSWR<Channel[], TownApiError>(
    ["channels"],
    () => client.channels.list(),
  );

  const { data: deliveriesData } = useSWR<DeliveryPage, TownApiError>(
    ["deliveries"],
    () => client.channels.deliveries.list({ limit: 20 }),
  );

  const { data: timelineData } = useSWR<TimelinePage, TownApiError>(
    ["timeline"],
    () => client.channels.timeline({ limit: 12 }),
  );

  const channels = channelsData ?? [];
  const deliveries = deliveriesData?.items ?? [];
  const timeline = timelineData?.items ?? [];

  const [kind, setKind] = useState<"email" | "sms" | "push" | "telegram" | "whatsapp" | "slack">("email");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (address.trim() === "") return;
    setSaving(true);
    try {
      await client.channels.create({ kind, address: address.trim() });
      setAddress("");
      void mutate();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: Channel["id"]) {
    await client.channels.delete(id as Channel["id"]);
    void mutate();
  }

  return (
    <section className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-xl font-semibold tracking-tight">Channels</h1>

      <div className="mb-6 rounded-lg border p-4" style={{ background: "var(--panel)", borderColor: "var(--panel-border)" }}>
        <h2 className="mb-3 text-sm font-medium">Add Channel</h2>
        <div className="flex gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            className="rounded-md border p-2 text-sm"
            style={{ borderColor: "var(--panel-border)", background: "var(--background)" }}
          >
            <option value="email">Email</option>
            <option value="sms">SMS</option>
            <option value="push">Push</option>
            <option value="telegram">Telegram</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="slack">Slack</option>
          </select>
          <input
            type="text"
            placeholder="Address (email, phone, etc.)"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="flex-1 rounded-md border p-2 text-sm"
            style={{ borderColor: "var(--panel-border)", background: "var(--background)" }}
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving}
            className="rounded-md px-3 py-2 text-sm font-medium transition-opacity disabled:opacity-60"
            style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}
          >
            {saving ? "..." : "Add"}
          </button>
        </div>
      </div>

      {isLoading ? (
        <LoadingState label="Loading channels..." />
      ) : error !== undefined ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error.message}
        </p>
      ) : channels.length === 0 ? (
        <EmptyState title="No notification channels configured." />
      ) : (
        <ul className="mb-6 flex flex-col gap-2">
          {channels.map((ch) => (
            <li key={ch.id}>
              <Link
                href={`/new/channels/${ch.id}`}
                className="block rounded-lg border p-4 transition-colors hover:bg-[color:var(--background)]"
                style={{ background: "var(--panel)", borderColor: "var(--panel-border)" }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <strong className="text-sm">{ch.kind}</strong>
                    <p className="text-xs" style={{ color: "var(--muted)" }}>{ch.address}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={ch.status} />
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); handleDelete(ch.id); }}
                      className="rounded-md border px-2 py-1 text-xs"
                      style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
                    >
                      Disable
                    </button>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mb-3 text-sm font-medium">Delivery Timeline</h2>
      {timeline.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>No delivery events yet.</p>
      ) : (
        <ul className="mb-6 flex flex-col gap-1">
          {timeline.map((item) => {
            const data = item.data;
            const label = typeof data["eventType"] === "string" ? data["eventType"] : item.kind;
            return (
              <li key={item.id} className="flex items-center justify-between rounded-md border p-2 text-xs" style={{ borderColor: "var(--panel-border)" }}>
                <span>{String(label)}</span>
                <time style={{ color: "var(--muted)" }}>{new Date(item.createdAt).toLocaleTimeString()}</time>
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="mb-3 text-sm font-medium">Delivery Records</h2>
      {deliveries.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>No delivery records.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {deliveries.map((d) => (
            <li key={d.id} className="flex items-center justify-between rounded-md border p-2 text-xs" style={{ borderColor: "var(--panel-border)" }}>
              <div>
                <strong>{d.eventType}</strong>
                <span style={{ color: "var(--muted)" }}> - attempts: {d.attempts}</span>
              </div>
              <StatusBadge status={d.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
