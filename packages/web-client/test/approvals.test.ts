import { describe, expect, it, vi } from "vitest";

import { newId } from "@town/contracts";

import { TownClient } from "../src/index.js";

type FetchCall = {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
};

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  const status = init.status ?? 200;
  if (body === null || status === 204) return new Response(null, { status });
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
      init: {
        ...init,
        headers: (init.headers ?? {}) as Record<string, string>,
      },
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

function approvalFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: newId<"approval">(),
    ownerId: newId<"user">(),
    toolCallId: newId<"tool-call">(),
    status: "pending",
    arguments: { query: "SELECT 1" },
    expiresAt: "2026-08-07T00:00:00.000Z",
    revision: 1,
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("TownClient approvals namespace", () => {
  it("lists approvals via GET /v1/approvals", async () => {
    const approval = approvalFixture();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ items: [approval], nextCursor: null })],
      calls,
      { token: "t" },
    );

    const page = await client.approvals.list({ limit: 10 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.status).toBe("pending");
    expect(page.nextCursor).toBeNull();
    expect(calls[0]?.url).toContain("limit=10");
  });

  it("gets a single approval via GET /v1/approvals/:id", async () => {
    const id = newId<"approval">();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ approval: approvalFixture({ id }) })],
      calls,
      { token: "t" },
    );

    const approval = await client.approvals.get(id);

    expect(approval.id).toBe(id);
    expect(calls[0]?.url).toBe(`https://api.example.test/v1/approvals/${id}`);
  });

  it("decides on an approval via POST /v1/approvals/:id/decision", async () => {
    const id = newId<"approval">();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [
        jsonResponse({
          approval: approvalFixture({ id, status: "approved", revision: 2 }),
        }),
      ],
      calls,
      { token: "t" },
    );

    const result = await client.approvals.decide(id, {
      expectedRevision: 1,
      decision: "approve",
    });

    expect(result.status).toBe("approved");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.url).toContain(`/v1/approvals/${id}/decision`);
    const body = JSON.parse(calls[0]?.init.body as string);
    expect(body.decision).toBe("approve");
  });
});
