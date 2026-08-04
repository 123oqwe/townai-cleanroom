import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { z } from "zod";

import { asId } from "@town/contracts";
import type { SquareRepository } from "@town/teams";
import type { AuthVariables } from "../src/auth.js";
import { registerSquareRoutes } from "../src/square-routes.js";

const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");
const squareId = asId<"square">("01900000-0000-7000-8000-000000000002");
const memberId = asId<"user">("01900000-0000-7000-8000-000000000003");

function withErrorMapping(app: Hono<{ Variables: AuthVariables }>) {
  app.onError((error, context) => {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return context.json({ code: "INVALID_REQUEST" }, 400);
    }
    return context.json({ code: "INTERNAL_ERROR" }, 500);
  });
}

function withIdentity(app: Hono<{ Variables: AuthVariables }>) {
  app.use("*", async (context, next) => {
    context.set("identity", {
      user: { id: ownerId, email: "owner@example.invalid" },
    } as AuthVariables["identity"]);
    await next();
  });
}

function buildSquareApp(repository: SquareRepository) {
  const app = new Hono<{ Variables: AuthVariables }>();
  withErrorMapping(app);
  withIdentity(app);
  registerSquareRoutes(app, { repository });
  return app;
}

describe("square routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("manages squares, members, and policy", async () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    const listSquareMembership = {
      id: squareId,
      ownerId,
      name: "Ops",
      slug: "ops-room",
      description: null,
      settings: { theme: "dark" },
      createdAt: now,
      updatedAt: now,
      membership: {
        squareId,
        userId: ownerId,
        ownerId,
        role: "owner" as const,
        status: "active" as const,
        invitedBy: null,
        createdAt: now,
        updatedAt: now,
      },
    };
    const square = {
      id: squareId,
      ownerId,
      name: "Ops",
      slug: "ops-room",
      description: null,
      settings: { theme: "dark" },
      createdAt: now,
      updatedAt: now,
    };
    const member = {
      squareId,
      userId: memberId,
      ownerId,
      role: "member" as const,
      status: "invited" as const,
      invitedBy: ownerId,
      createdAt: now,
      updatedAt: now,
    };
    const updatedMember = {
      ...member,
      status: "active" as const,
    };
    const policy = {
      squareId,
      ownerId,
      defaultMode: "read_only" as const,
      allowedDomains: ["town.ai"],
      allowedToolNames: ["weather.get"],
      settings: { locale: "en" },
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    const updatedPolicy = {
      ...policy,
      revision: 2,
      allowedToolNames: ["calendar.list"],
    };

    const repository = {
      listForUser: vi.fn(async () => [listSquareMembership]),
      create: vi.fn(async () => square),
      getForActor: vi.fn(async () => square),
      listMembers: vi.fn(async () => [member]),
      addMember: vi.fn(async () => member),
      updateMember: vi.fn(async () => updatedMember),
      getPolicy: vi.fn(async () => policy),
      updatePolicy: vi.fn(async () => updatedPolicy),
    } as unknown as SquareRepository;

    const app = buildSquareApp(repository);

    const list = await app.request("http://town.test/v1/squares");
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      squares: [
        {
          ...listSquareMembership,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          membership: {
            ...listSquareMembership.membership,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          },
        },
      ],
    });

    const create = await app.request("http://town.test/v1/squares", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Ops",
        slug: "ops-room",
        description: "Team operations",
        settings: {},
      }),
    });
    expect(create.status).toBe(201);
    expect(await create.json()).toMatchObject({
      square: {
        ...square,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    });
    expect(repository.create).toHaveBeenCalledWith({
      ownerId,
      name: "Ops",
      slug: "ops-room",
      description: "Team operations",
      settings: {},
    });

    const get = await app.request(`http://town.test/v1/squares/${squareId}`);
    expect(get.status).toBe(200);
    expect(await get.json()).toMatchObject({
      square: {
        ...square,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    });
    expect(repository.getForActor).toHaveBeenCalledWith(ownerId, squareId);

    const members = await app.request(
      `http://town.test/v1/squares/${squareId}/members`,
    );
    expect(members.status).toBe(200);
    expect(await members.json()).toMatchObject({
      members: [
        {
          ...member,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
    });
    expect(repository.listMembers).toHaveBeenCalledWith(ownerId, squareId);

    const addMember = await app.request(
      `http://town.test/v1/squares/${squareId}/members`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: memberId,
          role: "member",
          status: "invited",
        }),
      },
    );
    expect(addMember.status).toBe(201);
    expect(await addMember.json()).toMatchObject({
      membership: {
        ...member,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    });
    expect(repository.addMember).toHaveBeenCalledWith({
      ownerId,
      squareId,
      userId: memberId,
      role: "member",
      status: "invited",
      invitedBy: ownerId,
    });

    const patchMember = await app.request(
      `http://town.test/v1/squares/${squareId}/members/${memberId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      },
    );
    expect(patchMember.status).toBe(200);
    expect(await patchMember.json()).toMatchObject({
      membership: {
        ...updatedMember,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    });
    expect(repository.updateMember).toHaveBeenCalledWith({
      ownerId,
      squareId,
      userId: memberId,
      status: "active",
    });

    const getPolicy = await app.request(
      `http://town.test/v1/squares/${squareId}/policy`,
    );
    expect(getPolicy.status).toBe(200);
    expect(await getPolicy.json()).toMatchObject({
      policy: {
        ...policy,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    });
    expect(repository.getPolicy).toHaveBeenCalledWith(ownerId, squareId);

    const patchPolicy = await app.request(
      `http://town.test/v1/squares/${squareId}/policy`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedRevision: 1,
          defaultMode: "approval_required",
          allowedDomains: ["example.com"],
          allowedToolNames: ["calendar.list"],
          settings: { locale: "en" },
        }),
      },
    );
    expect(patchPolicy.status).toBe(200);
    expect(await patchPolicy.json()).toMatchObject({
      policy: {
        ...updatedPolicy,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    });
    expect(repository.updatePolicy).toHaveBeenCalledWith({
      ownerId,
      squareId,
      expectedRevision: 1,
      defaultMode: "approval_required",
      allowedDomains: ["example.com"],
      allowedToolNames: ["calendar.list"],
      settings: { locale: "en" },
    });
  });

  it("rejects malformed square requests", async () => {
    const repository = {
      listForUser: vi.fn(async () => []),
      create: vi.fn(),
      getForActor: vi.fn(),
      listMembers: vi.fn(),
      addMember: vi.fn(),
      updateMember: vi.fn(),
      getPolicy: vi.fn(),
      updatePolicy: vi.fn(),
    } as unknown as SquareRepository;
    const app = buildSquareApp(repository);

    const badCreate = await app.request("http://town.test/v1/squares", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "bad", name: "" }),
    });
    const badPolicyDecision = await app.request(
      `http://town.test/v1/squares/${squareId}/members/${memberId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );

    expect(await badCreate.json()).toMatchObject({ code: "INVALID_REQUEST" });
    expect(await badPolicyDecision.json()).toMatchObject({
      code: "INVALID_REQUEST",
    });
  });
});
