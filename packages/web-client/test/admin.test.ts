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

describe("TownClient admin namespace", () => {
  it("gets admin overview via GET /v1/admin/overview", async () => {
    const calls: FetchCall[] = [];
    const client = makeClient(
      [
        jsonResponse({
          users: 42,
          activeSessions: 3,
          routines: 15,
          squares: 2,
        }),
      ],
      calls,
      { token: "t" },
    );

    const overview = await client.admin.overview();

    expect(overview.users).toBe(42);
    expect(overview.activeSessions).toBe(3);
    expect(calls[0]?.url).toContain("/v1/admin/overview");
  });

  it("gets admin report via GET /v1/admin/reports/:slug", async () => {
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ slug: "weekly", data: { totalRuns: 100 } })],
      calls,
      { token: "t" },
    );

    const report = await client.admin.reports("weekly");

    expect(report.slug).toBe("weekly");
    expect(report.data["totalRuns"]).toBe(100);
    expect(calls[0]?.url).toContain("/v1/admin/reports/weekly");
  });

  it("gets admin agent health via GET /v1/admin/agent-health/:userId", async () => {
    const userId = newId<"user">();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [
        jsonResponse({
          userId,
          status: "healthy",
          lastActiveAt: "2026-08-06T00:00:00.000Z",
          details: { uptime: 3600 },
        }),
      ],
      calls,
      { token: "t" },
    );

    const health = await client.admin.agentHealth(userId);

    expect(health.status).toBe("healthy");
    expect(health.details["uptime"]).toBe(3600);
    expect(calls[0]?.url).toContain(`/v1/admin/agent-health/${userId}`);
  });

  it("gets admin user via GET /v1/admin/users/:userId", async () => {
    const userId = newId<"user">();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [
        jsonResponse({
          id: userId,
          email: "admin@example.com",
          status: "active",
          createdAt: "2026-08-06T00:00:00.000Z",
        }),
      ],
      calls,
      { token: "t" },
    );

    const user = await client.admin.users(userId);

    expect(user.email).toBe("admin@example.com");
    expect(calls[0]?.url).toContain(`/v1/admin/users/${userId}`);
  });

  it("gets admin team via GET /v1/admin/teams/:squareId", async () => {
    const squareId = newId<"square">();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [
        jsonResponse({
          squareId,
          members: [
            { userId: newId<"user">(), role: "owner", status: "active" },
          ],
        }),
      ],
      calls,
      { token: "t" },
    );

    const team = await client.admin.teams(squareId);

    expect(team.members).toHaveLength(1);
    expect(team.members[0]?.role).toBe("owner");
    expect(calls[0]?.url).toContain(`/v1/admin/teams/${squareId}`);
  });
});
