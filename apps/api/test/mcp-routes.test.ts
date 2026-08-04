import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { z } from "zod";

import { asId } from "@town/contracts";
import type { AuthenticatedIdentity } from "@town/identity";
import type { McpRepository } from "@town/tools";
import type { AuthVariables } from "../src/lib/auth.js";
import { registerMcpRoutes } from "../src/routes/mcp-routes.js";

const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");
const sessionId = asId<"auth-session">("01900000-0000-7000-8000-000000000009");
const mcpServerId = asId<"mcp-server">("01900000-0000-7000-8000-000000000002");
const anotherServerId = asId<"mcp-server">(
  "01900000-0000-7000-8000-000000000003",
);
const agentVersionId = asId<"agent-version">(
  "01900000-0000-7000-8000-000000000010",
);
const bindingId = asId<"mcp-server-binding">(
  "01900000-0000-7000-8000-000000000020",
);
const mcpIdentity: AuthenticatedIdentity = {
  user: {
    id: ownerId,
    email: "owner@example.test",
    firstName: null,
    lastName: null,
    timezone: "UTC",
    status: "active",
  },
  session: {
    id: sessionId,
    userId: ownerId,
    expiresAt: new Date("2026-08-01T00:00:00.000Z"),
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    lastSeenAt: new Date("2026-08-01T00:00:00.000Z"),
  },
};

function withErrorMapping(app: Hono<{ Variables: AuthVariables }>) {
  app.onError((error, context) => {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return context.json({ code: "INVALID_REQUEST" }, 400);
    return context.json({ code: "INTERNAL_ERROR", detail: String(error) }, 500);
  });
}

function withIdentity(app: Hono<{ Variables: AuthVariables }>) {
  app.use("*", async (context, next) => {
    context.set("identity", mcpIdentity);
    await next();
  });
}

function buildMcpApp(repository: McpRepository) {
  const app = new Hono<{ Variables: AuthVariables }>();
  withErrorMapping(app);
  withIdentity(app);
  registerMcpRoutes(app, repository);
  return app;
}

describe("mcp routes", () => {
  it("lists servers and bindings, creates and disables servers, creates and disables bindings", async () => {
    const server = {
      id: mcpServerId,
      ownerId,
      name: "Calendar",
      url: "https://example.invalid/calendar",
      transport: "streamable_http" as const,
      authRef: null,
      status: "active" as const,
      revision: 1,
      createdAt: new Date("2026-08-01T07:00:00.000Z"),
      updatedAt: new Date("2026-08-01T07:00:00.000Z"),
    };
    const second = {
      ...server,
      id: anotherServerId,
      name: "Search",
      url: "https://example.invalid/search",
      status: "disabled" as const,
      revision: 1,
    };
    const disabled = {
      ...server,
      revision: 2,
      status: "disabled" as const,
      updatedAt: new Date("2026-08-01T07:30:00.000Z"),
    };
    const binding = {
      id: bindingId,
      ownerId,
      agentVersionId,
      mcpServerId,
      modeOverride: "approval_required" as const,
      accountScope: ["calendar.read", "calendar.write"],
      enabled: true,
      revision: 1,
      createdAt: new Date("2026-08-01T08:00:00.000Z"),
      updatedAt: new Date("2026-08-01T08:00:00.000Z"),
    };
    const boundServer = {
      ...server,
      status: "active" as const,
      binding,
    };
    const disabledBinding = {
      ...binding,
      enabled: false,
      revision: 2,
      updatedAt: new Date("2026-08-01T08:30:00.000Z"),
    };

    const repository = {
      listForAgentVersion: vi.fn().mockResolvedValue([boundServer]),
      list: vi.fn().mockResolvedValue([server, second]),
      create: vi.fn().mockResolvedValue(server),
      disable: vi.fn().mockResolvedValue(disabled),
      bind: vi.fn().mockResolvedValue(binding),
      disableBinding: vi.fn().mockResolvedValue(disabledBinding),
    } as unknown as McpRepository;

    const app = buildMcpApp(repository);
    const bindings = await app.request(
      "/v1/mcp-servers/bindings?agentVersionId=" + agentVersionId,
    );
    const servers = await app.request("/v1/mcp-servers");
    const created = await app.request("/v1/mcp-servers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Calendar",
        url: "https://example.invalid/calendar",
      }),
    });
    const deleted = await app.request(
      `/v1/mcp-servers/${mcpServerId}?expectedRevision=1`,
      { method: "DELETE" },
    );
    const bound = await app.request(`/v1/mcp-servers/${mcpServerId}/bindings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentVersionId,
        modeOverride: "approval_required",
        accountScope: ["calendar.read", "calendar.write"],
      }),
    });
    const unbound = await app.request(
      `/v1/mcp-server-bindings/${bindingId}?expectedRevision=1`,
      { method: "DELETE" },
    );

    expect(bindings.status).toBe(200);
    expect(servers.status).toBe(200);
    expect(created.status).toBe(201);
    expect(deleted.status).toBe(200);
    expect(bound.status).toBe(201);
    expect(unbound.status).toBe(200);

    expect(await bindings.json()).toMatchObject({
      bindings: [
        {
          id: mcpServerId,
          name: "Calendar",
          url: "https://example.invalid/calendar",
          transport: "streamable_http",
          binding: { id: bindingId },
        },
      ],
    });
    expect(await servers.json()).toMatchObject({
      servers: [{ id: mcpServerId, name: "Calendar" }, { id: anotherServerId }],
    });
    expect(await created.json()).toMatchObject({
      server: {
        id: mcpServerId,
        name: "Calendar",
        transport: "streamable_http",
      },
    });
    expect(await deleted.json()).toMatchObject({
      server: { id: mcpServerId, status: "disabled", revision: 2 },
    });
    expect(await bound.json()).toMatchObject({
      binding: { id: bindingId, modeOverride: "approval_required" },
    });
    expect(await unbound.json()).toMatchObject({
      binding: { id: bindingId, enabled: false, revision: 2 },
    });

    expect(repository.listForAgentVersion).toHaveBeenCalledWith({
      ownerId,
      agentVersionId,
    });
    expect(repository.list).toHaveBeenCalledWith(ownerId);
    expect(repository.create).toHaveBeenCalledWith({
      ownerId,
      name: "Calendar",
      url: "https://example.invalid/calendar",
      transport: "streamable_http",
      authRef: undefined,
    });
    expect(repository.disable).toHaveBeenCalledWith(ownerId, mcpServerId, 1);
    expect(repository.bind).toHaveBeenCalledWith({
      ownerId,
      mcpServerId,
      agentVersionId,
      modeOverride: "approval_required",
      accountScope: ["calendar.read", "calendar.write"],
    });
    expect(repository.disableBinding).toHaveBeenCalledWith(
      ownerId,
      bindingId,
      1,
    );
  });

  it("validates strict request constraints", async () => {
    const repository = {
      listForAgentVersion: vi.fn(),
      list: vi.fn(),
      create: vi.fn(),
      disable: vi.fn(),
      bind: vi.fn(),
      disableBinding: vi.fn(),
    } as unknown as McpRepository;
    const app = buildMcpApp(repository);

    const missingQuery = await app.request("/v1/mcp-servers/bindings");
    const badCreate = await app.request("/v1/mcp-servers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "",
        url: "not-a-url",
        transport: "invalid",
      }),
    });
    const badDelete = await app.request(
      `/v1/mcp-servers/${mcpServerId}?expectedRevision=0`,
      { method: "DELETE" },
    );
    const badBinding = await app.request(
      `/v1/mcp-servers/${mcpServerId}/bindings`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountScope: ["calendar.read"],
        }),
      },
    );

    expect(missingQuery.status).toBe(400);
    expect(badCreate.status).toBe(400);
    expect(badDelete.status).toBe(400);
    expect(badBinding.status).toBe(400);
    expect(await missingQuery.json()).toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(await badCreate.json()).toMatchObject({ code: "INVALID_REQUEST" });
    expect(await badDelete.json()).toMatchObject({ code: "INVALID_REQUEST" });
    expect(await badBinding.json()).toMatchObject({ code: "INVALID_REQUEST" });
  });
});
