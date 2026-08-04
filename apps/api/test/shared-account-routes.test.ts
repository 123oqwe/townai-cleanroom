import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { z } from "zod";

import { asId } from "@town/contracts";
import type { SharedAccountRepository } from "@town/teams";
import type { AuthVariables } from "../src/auth.js";
import { registerSharedAccountRoutes } from "../src/shared-account-routes.js";

const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");
const squareId = asId<"square">("01900000-0000-7000-8000-000000000010");
const accountId = asId<"connected-account">(
  "01900000-0000-7000-8000-000000000020",
);
const shareId = asId<"square-account-share">(
  "01900000-0000-7000-8000-000000000030",
);

function withErrorMapping(app: Hono<{ Variables: AuthVariables }>) {
  app.onError((error, context) => {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return context.json({ code: "INVALID_REQUEST" }, 400);
    return context.json({ code: "INTERNAL_ERROR", detail: String(error) }, 500);
  });
}

function withIdentity(app: Hono<{ Variables: AuthVariables }>) {
  app.use("*", async (context, next) => {
    context.set("identity", {
      user: { id: ownerId, email: "owner@example.test" },
    });
    await next();
  });
}

function buildSharedAccountApp(repository: SharedAccountRepository) {
  const app = new Hono<{ Variables: AuthVariables }>();
  withErrorMapping(app);
  withIdentity(app);
  registerSharedAccountRoutes(app, { repository });
  return app;
}

describe("shared-account routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("lists accounts, grants shares, and revokes shares", async () => {
    const granted = {
      id: shareId,
      squareId,
      squareOwnerId: ownerId,
      accountId,
      accountOwnerId: ownerId,
      provider: "gmail",
      email: "owner@example.test",
      capabilities: ["read", "write"],
      status: "active" as const,
      grantedBy: ownerId,
      createdAt: new Date("2026-08-01T09:00:00.000Z"),
      revokedAt: null,
    };
    const repository = {
      list: vi.fn().mockResolvedValue([granted]),
      grant: vi.fn().mockResolvedValue(granted),
      revoke: vi.fn().mockResolvedValue(undefined),
    } as unknown as SharedAccountRepository;

    const app = buildSharedAccountApp(repository);
    const list = await app.request(`/v1/squares/${squareId}/accounts`);
    const grant = await app.request(`/v1/squares/${squareId}/accounts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId,
        accountOwnerId: ownerId,
        capabilities: ["read", "write"],
      }),
    });
    const revoke = await app.request(`/v1/square-account-shares/${shareId}`, {
      method: "DELETE",
    });

    expect(list.status).toBe(200);
    expect(grant.status).toBe(201);
    expect(revoke.status).toBe(204);
    expect(await list.json()).toMatchObject({
      accounts: [{ id: shareId, squareId, email: "owner@example.test" }],
    });
    expect(await grant.json()).toMatchObject({
      account: { id: shareId, accountId, accountOwnerId: ownerId },
    });
    expect(repository.list).toHaveBeenCalledWith(ownerId, squareId);
    expect(repository.grant).toHaveBeenCalledWith({
      actorId: ownerId,
      squareId,
      accountId,
      accountOwnerId: ownerId,
      capabilities: ["read", "write"],
    });
    expect(repository.revoke).toHaveBeenCalledWith(ownerId, shareId);
  });

  it("validates schemas for list and grant calls", async () => {
    const app = buildSharedAccountApp({
      list: vi.fn(),
      grant: vi.fn(),
      revoke: vi.fn(),
    } as unknown as SharedAccountRepository);
    const badList = await app.request("/v1/squares/not-a-uuid/accounts");
    const badGrant = await app.request(
      "/v1/squares/00000000-0000-0000-0000-000000000000/accounts",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId: "not-an-uuid",
          accountOwnerId: ownerId,
          capabilities: ["read", "write"],
        }),
      },
    );
    const tooLongCapabilities = await app.request(
      `/v1/squares/${squareId}/accounts`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId,
          accountOwnerId: ownerId,
          capabilities: [{}],
        }),
      },
    );
    expect(badList.status).toBe(400);
    expect(badGrant.status).toBe(400);
    expect(tooLongCapabilities.status).toBe(400);
    expect(await badList.json()).toMatchObject({ code: "INVALID_REQUEST" });
    expect(await badGrant.json()).toMatchObject({ code: "INVALID_REQUEST" });
    expect(await tooLongCapabilities.json()).toMatchObject({
      code: "INVALID_REQUEST",
    });
  });
});
