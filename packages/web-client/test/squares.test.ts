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

function squareFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: newId<"square">(),
    ownerId: newId<"user">(),
    name: "Team Alpha",
    slug: "team-alpha",
    description: "Alpha team square",
    status: "active",
    membership: { role: "owner", status: "active" },
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("TownClient squares namespace", () => {
  it("lists squares via GET /v1/squares", async () => {
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ squares: [squareFixture()] })],
      calls,
      { token: "t" },
    );

    const squares = await client.squares.list();

    expect(squares).toHaveLength(1);
    expect(squares[0]?.name).toBe("Team Alpha");
  });

  it("gets a square via GET /v1/squares/:id", async () => {
    const id = newId<"square">();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ square: squareFixture({ id }) })],
      calls,
      { token: "t" },
    );

    const square = await client.squares.get(id);

    expect(square.id).toBe(id);
    expect(calls[0]?.url).toContain(`/v1/squares/${id}`);
  });

  it("creates a square via POST /v1/squares", async () => {
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ square: squareFixture({ name: "New Team" }) })],
      calls,
      { token: "t" },
    );

    const square = await client.squares.create({
      name: "New Team",
      slug: "new-team",
    });

    expect(square.name).toBe("New Team");
    expect(calls[0]?.init.method).toBe("POST");
  });

  it("lists square members via GET /v1/squares/:id/members", async () => {
    const id = newId<"square">();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [
        jsonResponse({
          members: [
            {
              userId: newId<"user">(),
              role: "member",
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

    const members = await client.squares.members.list(id);

    expect(members).toHaveLength(1);
    expect(members[0]?.role).toBe("member");
  });

  it("adds a square member via POST /v1/squares/:id/members", async () => {
    const id = newId<"square">();
    const userId = newId<"user">();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [
        jsonResponse({
          member: {
            userId,
            role: "admin",
            status: "active",
            createdAt: "2026-08-06T00:00:00.000Z",
            updatedAt: "2026-08-06T00:00:00.000Z",
          },
        }),
      ],
      calls,
      { token: "t" },
    );

    const member = await client.squares.members.add(id, {
      userId,
      role: "admin",
    });

    expect(member.role).toBe("admin");
    expect(calls[0]?.init.method).toBe("POST");
  });

  it("updates a square member via PATCH /v1/squares/:id/members/:userId", async () => {
    const id = newId<"square">();
    const userId = newId<"user">();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [
        jsonResponse({
          member: {
            userId,
            role: "owner",
            status: "active",
            createdAt: "2026-08-06T00:00:00.000Z",
            updatedAt: "2026-08-06T00:00:00.000Z",
          },
        }),
      ],
      calls,
      { token: "t" },
    );

    const member = await client.squares.members.update(id, userId, {
      role: "owner",
      status: "active",
    });

    expect(member.role).toBe("owner");
    expect(calls[0]?.init.method).toBe("PATCH");
    expect(calls[0]?.url).toContain(`/v1/squares/${id}/members/${userId}`);
  });

  it("gets square policy via GET /v1/squares/:id/policy", async () => {
    const id = newId<"square">();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [
        jsonResponse({
          policy: {
            defaultMode: "autonomous",
            allowedDomains: ["example.com"],
            allowedToolNames: ["send_email"],
            settings: {},
            revision: 1,
          },
        }),
      ],
      calls,
      { token: "t" },
    );

    const policy = await client.squares.policy.get(id);

    expect(policy.defaultMode).toBe("autonomous");
    expect(policy.allowedDomains).toContain("example.com");
  });

  it("updates square policy via PATCH /v1/squares/:id/policy", async () => {
    const id = newId<"square">();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [
        jsonResponse({
          policy: {
            defaultMode: "require_approval",
            allowedDomains: [],
            allowedToolNames: [],
            settings: {},
            revision: 2,
          },
        }),
      ],
      calls,
      { token: "t" },
    );

    const policy = await client.squares.policy.update(id, {
      expectedRevision: 1,
      defaultMode: "require_approval",
      allowedDomains: [],
      allowedToolNames: [],
    });

    expect(policy.revision).toBe(2);
    expect(calls[0]?.init.method).toBe("PATCH");
  });

  it("lists square account shares via GET /v1/squares/:id/accounts", async () => {
    const id = newId<"square">();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [
        jsonResponse({
          accounts: [
            {
              id: newId<"square-account-share">(),
              provider: "google",
              email: "shared@example.com",
              capabilities: ["gmail"],
            },
          ],
        }),
      ],
      calls,
      { token: "t" },
    );

    const shares = await client.squares.accounts.list(id);

    expect(shares).toHaveLength(1);
    expect(shares[0]?.provider).toBe("google");
  });

  it("deletes a square account share via DELETE /v1/square-account-shares/:id", async () => {
    const shareId = newId<"square-account-share">();
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse(null, { status: 204 })], calls, {
      token: "t",
    });

    await client.squares.accounts.delete(shareId);

    expect(calls[0]?.init.method).toBe("DELETE");
    expect(calls[0]?.url).toContain(`/v1/square-account-shares/${shareId}`);
  });
});
