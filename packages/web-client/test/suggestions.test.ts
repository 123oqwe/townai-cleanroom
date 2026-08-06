import { describe, expect, it, vi } from "vitest";

import { newId } from "@town/contracts";

import { TownClient } from "../src/index.js";

type FetchCall = {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
};

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const status = init.status ?? 200;
  if (body === null || status === 204)
    return new Response(null, {
      status,
      headers: { ...(init.headers ?? {}) },
    });
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
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

function suggestionFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: newId<"suggestion">(),
    ownerId: newId<"user">(),
    kind: "follow_up",
    sourceType: "email",
    sourceRef: "msg-123",
    title: "Reply to Alice",
    body: "You should follow up on this thread.",
    status: "open",
    revision: 1,
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("TownClient suggestions namespace", () => {
  it("lists suggestions via GET /v1/suggestions with status filter", async () => {
    const suggestion = suggestionFixture();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ items: [suggestion], nextCursor: "c1" })],
      calls,
      { token: "t" },
    );

    const page = await client.suggestions.list({ status: "open", limit: 20 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.title).toBe("Reply to Alice");
    expect(page.nextCursor).toBe("c1");
    expect(calls[0]?.url).toContain("status=open");
    expect(calls[0]?.url).toContain("limit=20");
  });

  it("refreshes suggestions via POST /v1/suggestions/refresh", async () => {
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse(null, { status: 204 })], calls, {
      token: "t",
    });

    await client.suggestions.refresh();

    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.url).toContain("/v1/suggestions/refresh");
  });

  it("updates (dismisses) a suggestion via PATCH /v1/suggestions/:id", async () => {
    const id = newId<"suggestion">();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [
        jsonResponse({
          suggestion: suggestionFixture({
            id,
            status: "dismissed",
            revision: 2,
          }),
        }),
      ],
      calls,
      { token: "t" },
    );

    const result = await client.suggestions.update(id, {
      expectedRevision: 1,
      status: "dismissed",
    });

    expect(result.status).toBe("dismissed");
    expect(result.revision).toBe(2);
    expect(calls[0]?.init.method).toBe("PATCH");
    const body = JSON.parse(calls[0]?.init.body as string);
    expect(body.status).toBe("dismissed");
  });
});
