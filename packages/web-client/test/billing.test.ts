import { describe, expect, it, vi } from "vitest";

import { TownClient } from "../src/index.js";

type FetchCall = {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
};

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  const status = init.status ?? 200;
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

describe("TownClient billing namespace", () => {
  it("gets billing status via GET /v1/billing with period params", async () => {
    const calls: FetchCall[] = [];
    const client = makeClient(
      [
        jsonResponse({
          status: "configured",
          billing: {
            planName: "Pro",
            creditBand: "A",
            isBlocked: false,
          },
          usage: [
            { category: "api_calls", quantity: 1500, unit: "requests" },
          ],
          period: {
            start: "2026-07-01T00:00:00.000Z",
            end: "2026-08-01T00:00:00.000Z",
          },
        }),
      ],
      calls,
      { token: "t" },
    );

    const result = await client.billing.status({
      start: "2026-07-01T00:00:00.000Z",
      end: "2026-08-01T00:00:00.000Z",
    });

    expect(result.status).toBe("configured");
    expect(result.billing?.planName).toBe("Pro");
    expect(result.usage).toHaveLength(1);
    expect(result.usage?.[0]?.quantity).toBe(1500);
    expect(calls[0]?.url).toContain("start=2026-07-01");
    expect(calls[0]?.url).toContain("end=2026-08-01");
  });

  it("handles not_configured billing status", async () => {
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ status: "not_configured" })],
      calls,
      { token: "t" },
    );

    const result = await client.billing.status();

    expect(result.status).toBe("not_configured");
    expect(result.billing).toBeUndefined();
  });
});
