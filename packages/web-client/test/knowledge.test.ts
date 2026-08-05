import { describe, expect, it, vi } from "vitest";

import { newId } from "@town/contracts";

import { TownApiError, TownClient } from "../src/index.js";

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

function memoryFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: newId<"memory">(),
    ownerId: newId<"user">(),
    scope: "global",
    routineId: null,
    content: "Prefers concise summaries.",
    status: "active",
    confidence: 0.8,
    observedAt: "2026-08-06T00:00:00.000Z",
    expiresAt: null,
    currentRevision: 1,
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
    ...overrides,
  };
}

function personFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: newId<"person">(),
    ownerId: newId<"user">(),
    displayName: "Ada Lovelace",
    primaryEmail: "ada@example.test",
    category: "coworker",
    organization: "Analytical Engine Co",
    role: "Mathematician",
    notes: "Pioneer of computing.",
    status: "active",
    currentRevision: 1,
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
    ...overrides,
  };
}

function wikiFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: newId<"wiki">(),
    ownerId: newId<"user">(),
    kind: "page",
    slug: "onboarding",
    title: "Onboarding",
    body: "Welcome to Town.",
    status: "active",
    currentRevision: 1,
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("TownClient knowledge.profile namespace", () => {
  it("unwraps the profile from GET /v1/profile", async () => {
    const profile = {
      id: newId<"profile">(),
      ownerId: newId<"user">(),
      content: { timezone: "UTC" },
      currentRevision: 3,
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z",
    };
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse({ profile })], calls, {
      token: "t",
    });

    const result = await client.knowledge.profile.get();

    expect(calls[0]?.url).toBe("https://api.example.test/v1/profile");
    expect(calls[0]?.init.method).toBe("GET");
    expect(result.currentRevision).toBe(3);
    expect(result.content).toEqual({ timezone: "UTC" });
  });

  it("creates a profile via POST /v1/profile and unwraps it", async () => {
    const profile = {
      id: newId<"profile">(),
      ownerId: newId<"user">(),
      content: { timezone: "Asia/Shanghai" },
      currentRevision: 1,
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z",
    };
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ profile }, { status: 201 })],
      calls,
      { token: "t" },
    );

    const result = await client.knowledge.profile.create({
      timezone: "Asia/Shanghai",
    });

    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      content: { timezone: "Asia/Shanghai" },
    });
    expect(result.currentRevision).toBe(1);
  });

  it("updates a profile via PUT /v1/profile with expectedRevision", async () => {
    const result = {
      kind: "applied",
      profile: {
        id: newId<"profile">(),
        ownerId: newId<"user">(),
        content: { timezone: "UTC" },
        currentRevision: 4,
        createdAt: "2026-08-06T00:00:00.000Z",
        updatedAt: "2026-08-06T00:00:00.000Z",
      },
    };
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse(result)], calls, { token: "t" });

    const out = await client.knowledge.profile.update({ timezone: "UTC" }, 3);

    expect(calls[0]?.init.method).toBe("PUT");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      content: { timezone: "UTC" },
      expectedRevision: 3,
    });
    expect(out.kind).toBe("applied");
  });

  it("fetches profile history from GET /v1/profile/history", async () => {
    const revisions = [
      {
        id: newId<"knowledge-revision">(),
        ownerId: newId<"user">(),
        resourceType: "profile",
        resourceId: newId<"profile">(),
        revision: 1,
        baseRevision: 0,
        authorType: "user",
        snapshot: { content: { timezone: "UTC" } },
        changeReason: null,
        createdAt: "2026-08-06T00:00:00.000Z",
        citations: [],
      },
    ];
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse({ revisions })], calls, {
      token: "t",
    });

    const result = await client.knowledge.profile.history();

    expect(calls[0]?.url).toBe("https://api.example.test/v1/profile/history");
    expect(result).toHaveLength(1);
    expect(result[0]?.revision).toBe(1);
  });
});

describe("TownClient knowledge.memories namespace", () => {
  it("lists memories from GET /v1/memories and unwraps the array", async () => {
    const memories = [memoryFixture(), memoryFixture({ content: "Second" })];
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse({ memories })], calls, {
      token: "t",
    });

    const result = await client.knowledge.memories.list();

    expect(calls[0]?.url).toBe("https://api.example.test/v1/memories");
    expect(calls[0]?.init.method).toBe("GET");
    expect(result).toHaveLength(2);
    expect(result[1]?.content).toBe("Second");
  });

  it("creates a global memory via POST /v1/memories", async () => {
    const memory = memoryFixture({ content: "New fact" });
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ memory }, { status: 201 })],
      calls,
      { token: "t" },
    );

    const result = await client.knowledge.memories.create({
      scope: "global",
      content: "New fact",
      confidence: 0.9,
    });

    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      scope: "global",
      content: "New fact",
      confidence: 0.9,
    });
    expect(result.content).toBe("New fact");
  });

  it("updates a memory via PUT /v1/memories/:id", async () => {
    const id = newId<"memory">();
    const result = {
      kind: "applied" as const,
      memory: memoryFixture({ id, currentRevision: 2 }),
    };
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse(result)], calls, { token: "t" });

    const out = await client.knowledge.memories.update(id, {
      scope: "global",
      content: "Edited",
      status: "active",
      expectedRevision: 1,
    });

    expect(calls[0]?.url).toBe(`https://api.example.test/v1/memories/${id}`);
    expect(calls[0]?.init.method).toBe("PUT");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      scope: "global",
      content: "Edited",
      status: "active",
      expectedRevision: 1,
    });
    expect(out.kind).toBe("applied");
  });

  it("deletes a memory via DELETE /v1/memories/:id with expectedRevision query", async () => {
    const id = newId<"memory">();
    const memory = memoryFixture({ id, status: "retired" });
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse({ memory })], calls, {
      token: "t",
    });

    const result = await client.knowledge.memories.delete(id, 1);

    expect(calls[0]?.url).toBe(
      `https://api.example.test/v1/memories/${id}?expectedRevision=1`,
    );
    expect(calls[0]?.init.method).toBe("DELETE");
    expect(result.status).toBe("retired");
  });
});

describe("TownClient knowledge.people namespace", () => {
  it("lists people from GET /v1/people and unwraps the array", async () => {
    const people = [personFixture()];
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse({ people })], calls, {
      token: "t",
    });

    const result = await client.knowledge.people.list();

    expect(calls[0]?.url).toBe("https://api.example.test/v1/people");
    expect(result).toHaveLength(1);
    expect(result[0]?.displayName).toBe("Ada Lovelace");
  });

  it("creates a person via POST /v1/people", async () => {
    const person = personFixture({ displayName: "Grace Hopper" });
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ person }, { status: 201 })],
      calls,
      { token: "t" },
    );

    const result = await client.knowledge.people.create({
      displayName: "Grace Hopper",
      category: "coworker",
      notes: "Compiler pioneer.",
    });

    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      displayName: "Grace Hopper",
      category: "coworker",
      notes: "Compiler pioneer.",
    });
    expect(result.displayName).toBe("Grace Hopper");
  });

  it("updates a person via PUT /v1/people/:id", async () => {
    const id = newId<"person">();
    const result = {
      kind: "applied" as const,
      person: personFixture({ id, currentRevision: 2 }),
    };
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse(result)], calls, { token: "t" });

    const out = await client.knowledge.people.update(id, {
      displayName: "Grace",
      category: "personal",
      notes: "Friend.",
      expectedRevision: 1,
    });

    expect(calls[0]?.init.method).toBe("PUT");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      displayName: "Grace",
      category: "personal",
      notes: "Friend.",
      expectedRevision: 1,
    });
    expect(out.kind).toBe("applied");
  });

  it("gets a single person by id", async () => {
    const person = personFixture();
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse({ person })], calls, {
      token: "t",
    });

    const result = await client.knowledge.people.get(person.id);

    expect(calls[0]?.url).toBe(
      `https://api.example.test/v1/people/${person.id}`,
    );
    expect(result.displayName).toBe("Ada Lovelace");
  });

  it("lists relationships with includeRetired flag", async () => {
    const personId = newId<"person">();
    const relationships = [
      {
        id: newId<"person-relationship">(),
        ownerId: newId<"user">(),
        personId,
        relatedPersonId: newId<"person">(),
        relationshipType: "collaborator",
        notes: "",
        status: "active",
        revision: 1,
        createdAt: "2026-08-06T00:00:00.000Z",
        updatedAt: "2026-08-06T00:00:00.000Z",
      },
    ];
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse({ relationships })], calls, {
      token: "t",
    });

    const result = await client.knowledge.people.relationships(personId, {
      includeRetired: true,
    });

    expect(calls[0]?.url).toBe(
      `https://api.example.test/v1/people/${personId}/relationships?includeRetired=true`,
    );
    expect(result).toHaveLength(1);
  });

  it("adds a relationship via POST /v1/people/:id/relationships", async () => {
    const personId = newId<"person">();
    const relatedId = newId<"person">();
    const relationship = {
      id: newId<"person-relationship">(),
      ownerId: newId<"user">(),
      personId,
      relatedPersonId: relatedId,
      relationshipType: "mentor",
      notes: "Guided early work.",
      status: "active",
      revision: 1,
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z",
    };
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ relationship }, { status: 201 })],
      calls,
      { token: "t" },
    );

    const result = await client.knowledge.people.addRelationship(personId, {
      relatedPersonId: relatedId,
      relationshipType: "mentor",
      notes: "Guided early work.",
    });

    expect(calls[0]?.url).toBe(
      `https://api.example.test/v1/people/${personId}/relationships`,
    );
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      relatedPersonId: relatedId,
      relationshipType: "mentor",
      notes: "Guided early work.",
    });
    expect(result.relationshipType).toBe("mentor");
  });

  it("deletes a relationship via DELETE /v1/people/relationships/:id", async () => {
    const relationshipId = newId<"person-relationship">();
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse(null, { status: 204 })], calls, {
      token: "t",
    });

    await client.knowledge.people.deleteRelationship(relationshipId, 2);

    expect(calls[0]?.url).toBe(
      `https://api.example.test/v1/people/relationships/${relationshipId}?expectedRevision=2`,
    );
    expect(calls[0]?.init.method).toBe("DELETE");
  });
});

describe("TownClient knowledge.wiki namespace", () => {
  it("lists wiki documents from GET /v1/wiki and unwraps the array", async () => {
    const documents = [wikiFixture()];
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse({ documents })], calls, {
      token: "t",
    });

    const result = await client.knowledge.wiki.list();

    expect(calls[0]?.url).toBe("https://api.example.test/v1/wiki");
    expect(result).toHaveLength(1);
    expect(result[0]?.slug).toBe("onboarding");
  });

  it("creates a wiki page via POST /v1/wiki", async () => {
    const document = wikiFixture({ title: "Policies" });
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ document }, { status: 201 })],
      calls,
      { token: "t" },
    );

    const result = await client.knowledge.wiki.create({
      kind: "page",
      slug: "policies",
      title: "Policies",
      body: "Be excellent.",
    });

    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      kind: "page",
      slug: "policies",
      title: "Policies",
      body: "Be excellent.",
    });
    expect(result.title).toBe("Policies");
  });

  it("updates a wiki page via PUT /v1/wiki/:id", async () => {
    const id = newId<"wiki">();
    const result = {
      kind: "applied" as const,
      document: wikiFixture({ id, currentRevision: 2 }),
    };
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse(result)], calls, { token: "t" });

    const out = await client.knowledge.wiki.update(id, {
      kind: "page",
      slug: "onboarding",
      title: "Onboarding v2",
      body: "Updated.",
      expectedRevision: 1,
    });

    expect(calls[0]?.url).toBe(`https://api.example.test/v1/wiki/${id}`);
    expect(calls[0]?.init.method).toBe("PUT");
    expect(out.kind).toBe("applied");
  });

  it("fetches wiki history from GET /v1/wiki/:id/revisions", async () => {
    const id = newId<"wiki">();
    const revisions = [
      {
        id: newId<"knowledge-revision">(),
        ownerId: newId<"user">(),
        resourceType: "wiki",
        resourceId: id,
        revision: 1,
        baseRevision: 0,
        authorType: "user",
        snapshot: { title: "Onboarding", body: "Welcome." },
        changeReason: null,
        createdAt: "2026-08-06T00:00:00.000Z",
        citations: [],
      },
    ];
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse({ revisions })], calls, {
      token: "t",
    });

    const result = await client.knowledge.wiki.history(id);

    expect(calls[0]?.url).toBe(
      `https://api.example.test/v1/wiki/${id}/revisions`,
    );
    expect(result[0]?.revision).toBe(1);
  });
});

describe("TownClient knowledge.search namespace", () => {
  it("searches GET /v1/knowledge/search with q and limit", async () => {
    const page = {
      items: [
        {
          ownerId: newId<"user">(),
          resourceType: "memory",
          resourceId: newId<"memory">(),
          title: "Prefers concise summaries",
          text: "Prefers concise summaries.",
          subtype: null,
          status: "active",
          score: 0.92,
          updatedAt: "2026-08-06T00:00:00.000Z",
        },
      ],
      nextCursor: null,
    };
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse(page)], calls, { token: "t" });

    const result = await client.knowledge.search.search("concise", {
      limit: 10,
    });

    expect(calls[0]?.url).toBe(
      "https://api.example.test/v1/knowledge/search?q=concise&limit=10",
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.score).toBe(0.92);
  });

  it("passes cursor and types query params through", async () => {
    const page = { items: [], nextCursor: "abc" };
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse(page)], calls, { token: "t" });

    const result = await client.knowledge.search.search("x", {
      cursor: "abc",
      limit: 20,
      types: ["memory", "wiki"],
      includeInactive: true,
    });

    const url = new URL(calls[0]?.url ?? "");
    expect(url.pathname).toBe("/v1/knowledge/search");
    expect(url.searchParams.get("q")).toBe("x");
    expect(url.searchParams.get("cursor")).toBe("abc");
    expect(url.searchParams.get("limit")).toBe("20");
    expect(url.searchParams.get("types")).toBe("memory,wiki");
    expect(url.searchParams.get("includeInactive")).toBe("true");
    expect(result.nextCursor).toBe("abc");
  });
});

describe("TownClient knowledge.conflicts namespace", () => {
  it("lists conflicts from GET /v1/knowledge/conflicts", async () => {
    const conflict = {
      id: newId<"knowledge-conflict">(),
      ownerId: newId<"user">(),
      resourceType: "memory",
      resourceId: newId<"memory">(),
      baseRevision: 1,
      currentRevision: 2,
      proposedAuthorType: "assistant",
      proposedSnapshot: { content: "Updated by assistant" },
      status: "pending",
      createdAt: "2026-08-06T00:00:00.000Z",
      resolvedAt: null,
    };
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ conflicts: [conflict] })],
      calls,
      {
        token: "t",
      },
    );

    const result = await client.knowledge.conflicts.list();

    expect(calls[0]?.url).toBe(
      "https://api.example.test/v1/knowledge/conflicts",
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe("pending");
  });

  it("resolves a conflict via POST /v1/knowledge/conflicts/:id/resolve", async () => {
    const id = newId<"knowledge-conflict">();
    const resolveResult = {
      kind: "resolved",
      revision: {
        id: newId<"knowledge-revision">(),
        ownerId: newId<"user">(),
        resourceType: "memory",
        resourceId: newId<"memory">(),
        revision: 3,
        baseRevision: 2,
        authorType: "assistant",
        snapshot: { content: "Updated by assistant" },
        changeReason: null,
        createdAt: "2026-08-06T00:00:00.000Z",
        citations: [],
      },
    };
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse(resolveResult)], calls, {
      token: "t",
    });

    const result = await client.knowledge.conflicts.resolve(id, 2, "accept");

    expect(calls[0]?.url).toBe(
      `https://api.example.test/v1/knowledge/conflicts/${id}/resolve`,
    );
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      expectedRevision: 2,
      resolution: "accept",
    });
    expect(result.kind).toBe("resolved");
  });
});

describe("TownClient knowledge error handling", () => {
  it("throws TownApiError with 404 when profile is missing", async () => {
    const client = makeClient(
      [
        jsonResponse(
          { code: "PROFILE_NOT_FOUND", detail: "not found", status: 404 },
          { status: 404 },
        ),
      ],
      [],
      { token: "t" },
    );

    await expect(client.knowledge.profile.get()).rejects.toMatchObject({
      name: "TownApiError",
      status: 404,
      code: "PROFILE_NOT_FOUND",
    });
  });

  it("throws TownApiError with 401 on memories.list", async () => {
    const client = makeClient(
      [
        jsonResponse(
          { code: "UNAUTHENTICATED", detail: "bad token", status: 401 },
          { status: 401 },
        ),
      ],
      [],
      { token: "bad" },
    );

    await expect(client.knowledge.memories.list()).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    });
  });

  it("throws TownApiError with 403 on people.create", async () => {
    const client = makeClient(
      [
        jsonResponse(
          { code: "ACCESS_DENIED", detail: "forbidden", status: 403 },
          { status: 403 },
        ),
      ],
      [],
    );

    await expect(
      client.knowledge.people.create({
        displayName: "x",
        category: "uncategorized",
        notes: "",
      }),
    ).rejects.toMatchObject({ status: 403, code: "ACCESS_DENIED" });
  });

  it("throws TownApiError with 429 on search", async () => {
    const client = makeClient(
      [
        jsonResponse(
          { code: "RATE_LIMITED", detail: "slow down", status: 429 },
          { status: 429 },
        ),
      ],
      [],
    );

    await expect(client.knowledge.search.search("x")).rejects.toBeInstanceOf(
      TownApiError,
    );
  });
});
