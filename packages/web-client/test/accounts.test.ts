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

function accountFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: newId<"connected-account">(),
    ownerId: newId<"user">(),
    provider: "google",
    email: "user@example.com",
    capabilities: { gmail: true, calendar: true },
    needsReauth: false,
    isActive: true,
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("TownClient accounts namespace", () => {
  it("lists accounts via GET /v1/accounts", async () => {
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ accounts: [accountFixture()] })],
      calls,
      { token: "t" },
    );

    const accounts = await client.accounts.list();

    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.provider).toBe("google");
    expect(accounts[0]?.capabilities["gmail"]).toBe(true);
  });

  it("updates credential via PATCH /v1/accounts/:id/credential", async () => {
    const id = newId<"connected-account">();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ account: accountFixture({ id }) })],
      calls,
      { token: "t" },
    );

    const account = await client.accounts.updateCredential(id, {
      accessToken: "new-token",
      scopes: ["gmail"],
    });

    expect(account.id).toBe(id);
    expect(calls[0]?.init.method).toBe("PATCH");
    expect(calls[0]?.url).toContain(`/v1/accounts/${id}/credential`);
    const body = JSON.parse(calls[0]?.init.body as string);
    expect(body.accessToken).toBe("new-token");
  });

  it("refreshes an account via POST /v1/accounts/:id/refresh", async () => {
    const id = newId<"connected-account">();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ account: accountFixture({ id, needsReauth: false }) })],
      calls,
      { token: "t" },
    );

    const account = await client.accounts.refresh(id);

    expect(account.needsReauth).toBe(false);
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.url).toContain(`/v1/accounts/${id}/refresh`);
  });

  it("deletes an account via DELETE /v1/accounts/:id", async () => {
    const id = newId<"connected-account">();
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse(null, { status: 204 })], calls, {
      token: "t",
    });

    await client.accounts.delete(id);

    expect(calls[0]?.init.method).toBe("DELETE");
    expect(calls[0]?.url).toContain(`/v1/accounts/${id}`);
  });

  it("starts google oauth via GET /v1/accounts/google/oauth/start returning redirect URL", async () => {
    const calls: FetchCall[] = [];
    const redirectUrl =
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=xxx";
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        init: {
          ...init,
          headers: (init.headers ?? {}) as Record<string, string>,
        },
      });
      return new Response(null, {
        status: 302,
        headers: { location: redirectUrl },
      });
    }) as unknown as typeof globalThis.fetch;
    const client = new TownClient({
      baseUrl: "https://api.example.test",
      token: "t",
      fetch: fetchImpl,
    });

    const result = await client.accounts.google.oauth.start();

    expect(result).toBe(redirectUrl);
    expect(calls[0]?.init.redirect).toBe("manual");
  });
});
