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

function serverFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: newId<"mcp-server">(),
    ownerId: newId<"user">(),
    name: "my-server",
    url: "https://mcp.example.com/sse",
    transport: "sse",
    authRef: null,
    status: "active",
    revision: 1,
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
    ...overrides,
  };
}

function bindingFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: newId<"mcp-binding">(),
    ownerId: newId<"user">(),
    serverId: newId<"mcp-server">(),
    agentVersionId: newId<"agent-version">(),
    modeOverride: null,
    accountScope: [],
    revision: 1,
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("TownClient mcp namespace", () => {
  it("lists MCP servers via GET /v1/mcp-servers", async () => {
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ servers: [serverFixture()] })],
      calls,
      { token: "t" },
    );

    const servers = await client.mcp.servers.list();

    expect(servers).toHaveLength(1);
    expect(servers[0]?.name).toBe("my-server");
  });

  it("creates an MCP server via POST /v1/mcp-servers", async () => {
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ server: serverFixture({ name: "new-server" }) })],
      calls,
      { token: "t" },
    );

    const server = await client.mcp.servers.create({
      name: "new-server",
      url: "https://mcp.example.com/sse",
      transport: "sse",
    });

    expect(server.name).toBe("new-server");
    expect(calls[0]?.init.method).toBe("POST");
  });

  it("deletes an MCP server via DELETE /v1/mcp-servers/:id", async () => {
    const id = newId<"mcp-server">();
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse(null, { status: 204 })], calls, {
      token: "t",
    });

    await client.mcp.servers.delete(id, 2);

    expect(calls[0]?.init.method).toBe("DELETE");
    expect(calls[0]?.url).toContain(`expectedRevision=2`);
  });

  it("lists MCP bindings via GET /v1/mcp-servers/bindings with agentVersionId", async () => {
    const agentVersionId = newId<"agent-version">();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ bindings: [bindingFixture({ agentVersionId })] })],
      calls,
      { token: "t" },
    );

    const bindings = await client.mcp.bindings.list({ agentVersionId });

    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.agentVersionId).toBe(agentVersionId);
    expect(calls[0]?.url).toContain(`agentVersionId=${agentVersionId}`);
  });

  it("creates an MCP binding via POST /v1/mcp-servers/:serverId/bindings", async () => {
    const serverId = newId<"mcp-server">();
    const agentVersionId = newId<"agent-version">();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ binding: bindingFixture({ serverId, agentVersionId }) })],
      calls,
      { token: "t" },
    );

    const binding = await client.mcp.bindings.create(serverId, {
      agentVersionId,
    });

    expect(binding.serverId).toBe(serverId);
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.url).toContain(`/v1/mcp-servers/${serverId}/bindings`);
  });

  it("deletes an MCP binding via DELETE /v1/mcp-server-bindings/:id", async () => {
    const id = newId<"mcp-binding">();
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse(null, { status: 204 })], calls, {
      token: "t",
    });

    await client.mcp.bindings.delete(id, 1);

    expect(calls[0]?.init.method).toBe("DELETE");
    expect(calls[0]?.url).toContain(`/v1/mcp-server-bindings/${id}`);
  });
});
