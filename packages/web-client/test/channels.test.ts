import { describe, expect, it, vi } from "vitest";

import { newId } from "@town/contracts";

import { TownClient } from "../src/index.js";

type FetchCall = {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
};

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  const status = init.status ?? 200;
  if (body === null || status === 204)
    return new Response(null, { status });
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeClient(
  responses: Response[],
  calls: FetchCall[],
  options: { token?: string } = {},
): TownClient {
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({
      url,
      init: { ...init, headers: (init.headers ?? {}) as Record<string, string> },
    });
    const response = responses.shift();
    if (response === undefined) throw new Error("no mock response queued");
    return response;
  }) as unknown as typeof globalThis.fetch;
  return new TownClient({
    baseUrl: "https://api.example.test",
    ...(options.token === undefined ? {} : { token: options.token }),
    fetch: fetchImpl,
  });
}

describe("TownClient channels namespace", () => {
  it("lists channels via GET /v1/channels", async () => {
    const calls: FetchCall[] = [];
    const client = makeClient(
      [
        jsonResponse({
          channels: [
            {
              id: newId<"channel">(),
              ownerId: newId<"user">(),
              kind: "email",
              address: "user@example.com",
              config: {},
              status: "active",
              createdAt: "2026-08-06T00:00:00.000Z",
              updatedAt: "2026-08-06T00:00:00.000Z",
            },
          ],
        }),
      ],
      calls,
      { token: "t" },
    );

    const channels = await client.channels.list();

    expect(channels).toHaveLength(1);
    expect(channels[0]?.kind).toBe("email");
  });

  it("creates a channel via POST /v1/channels", async () => {
    const calls: FetchCall[] = [];
    const client = makeClient(
      [
        jsonResponse({
          channel: {
            id: newId<"channel">(),
            ownerId: newId<"user">(),
            kind: "telegram",
            address: "@mybot",
            config: { credentialRef: "ref1" },
            status: "active",
            createdAt: "2026-08-06T00:00:00.000Z",
            updatedAt: "2026-08-06T00:00:00.000Z",
          },
        }),
      ],
      calls,
      { token: "t" },
    );

    const channel = await client.channels.create({
      kind: "telegram",
      address: "@mybot",
      config: { credentialRef: "ref1" },
    });

    expect(channel.kind).toBe("telegram");
    expect(calls[0]?.init.method).toBe("POST");
    const body = JSON.parse(calls[0]?.init.body as string);
    expect(body.kind).toBe("telegram");
  });

  it("deletes a channel via DELETE /v1/channels/:id", async () => {
    const id = newId<"channel">();
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse(null, { status: 204 })], calls, {
      token: "t",
    });

    await client.channels.delete(id);

    expect(calls[0]?.init.method).toBe("DELETE");
    expect(calls[0]?.url).toContain(`/v1/channels/${id}`);
  });

  it("lists deliveries via GET /v1/notification-deliveries with status filter", async () => {
    const calls: FetchCall[] = [];
    const client = makeClient(
      [
        jsonResponse({
          items: [
            {
              id: newId<"notification-delivery">(),
              ownerId: newId<"user">(),
              channelId: newId<"channel">(),
              eventType: "summary",
              status: "failed",
              attempts: 3,
              lastError: "timeout",
              nextAttemptAt: null,
              createdAt: "2026-08-06T00:00:00.000Z",
              updatedAt: "2026-08-06T00:00:00.000Z",
            },
          ],
          nextCursor: null,
        }),
      ],
      calls,
      { token: "t" },
    );

    const page = await client.channels.deliveries.list({
      status: "failed",
      limit: 20,
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.status).toBe("failed");
    expect(calls[0]?.url).toContain("status=failed");
  });

  it("replays a delivery via POST /v1/notification-deliveries/:id/replay", async () => {
    const id = newId<"notification-delivery">();
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse(null, { status: 204 })], calls, {
      token: "t",
    });

    await client.channels.deliveries.replay(id);

    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.url).toContain(`/v1/notification-deliveries/${id}/replay`);
  });

  it("gets timeline via GET /v1/notification-timeline", async () => {
    const calls: FetchCall[] = [];
    const client = makeClient(
      [
        jsonResponse({
          items: [
            {
              id: "evt-1",
              kind: "delivery",
              data: { status: "sent" },
              createdAt: "2026-08-06T00:00:00.000Z",
            },
          ],
          nextCursor: "c2",
        }),
      ],
      calls,
      { token: "t" },
    );

    const page = await client.channels.timeline({ limit: 12 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.kind).toBe("delivery");
    expect(page.nextCursor).toBe("c2");
  });
});
