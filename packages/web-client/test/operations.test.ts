import { describe, expect, it, vi } from "vitest";

import { newId } from "@town/contracts";

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

describe("TownClient operations namespace", () => {
  it("lists audit events via GET /v1/operations/audit with filters", async () => {
    const calls: FetchCall[] = [];
    const client = makeClient(
      [
        jsonResponse({
          items: [
            {
              id: "evt-1",
              ownerId: newId<"user">(),
              action: "tool.execute",
              resourceType: "tool-call",
              resourceId: "tc-123",
              outcome: "success",
              createdAt: "2026-08-06T00:00:00.000Z",
            },
          ],
          nextCursor: null,
        }),
      ],
      calls,
      { token: "t" },
    );

    const page = await client.operations.audit.list({
      action: "tool.execute",
      limit: 5,
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.action).toBe("tool.execute");
    expect(calls[0]?.url).toContain("action=tool.execute");
    expect(calls[0]?.url).toContain("limit=5");
  });

  it("gets operations summary via GET /v1/operations/summary", async () => {
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ summary: { tasks: 10, routines: 5 } })],
      calls,
      { token: "t" },
    );

    const result = await client.operations.summary();

    expect(result.summary["tasks"]).toBe(10);
    expect(result.summary["routines"]).toBe(5);
  });

  it("gets schedule via GET /v1/schedule with limit", async () => {
    const calls: FetchCall[] = [];
    const client = makeClient(
      [
        jsonResponse({
          items: [
            {
              id: "evt-1",
              kind: "calendar",
              title: "Standup",
              startAt: "2026-08-06T09:00:00.000Z",
              endAt: "2026-08-06T09:30:00.000Z",
              calendarId: "cal-1",
            },
          ],
          calendars: [{ id: "cal-1", name: "Work" }],
          calendarErrors: [],
        }),
      ],
      calls,
      { token: "t" },
    );

    const result = await client.operations.schedule({ limit: 12 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe("Standup");
    expect(result.calendars[0]?.name).toBe("Work");
    expect(calls[0]?.url).toContain("limit=12");
  });
});
