import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { z } from "zod";

import { asId } from "@town/contracts";
import type { AuthenticatedIdentity } from "@town/identity";
import type {
  KnowledgeConflictService,
  ProfileRepository,
  MemoryRepository,
  PeopleRepository,
  WikiRepository,
  RevisionRepository,
  KnowledgeSearchRepository,
  WikiUpkeepScanner,
} from "@town/knowledge";
import * as knowledge from "@town/knowledge";
import type { AuthVariables } from "../src/auth.js";
import { registerKnowledgeRoutes } from "../src/knowledge-routes.js";

const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");
const sessionId = asId<"auth-session">("01900000-0000-7000-8000-000000000009");
const memoryId = asId<"memory">("01900000-0000-7000-8000-000000000003");
const personId = asId<"person">("01900000-0000-7000-8000-000000000004");
const personRelId = asId<"person-relationship">(
  "01900000-0000-7000-8000-000000000005",
);
const routineId = asId<"routine">("01900000-0000-7000-8000-000000000006");
const wikiId = asId<"wiki">("01900000-0000-7000-8000-000000000007");
const relatedPersonId = asId<"person">("01900000-0000-7000-8000-000000000008");
const conflictId = asId<"knowledge-conflict">(
  "01900000-0000-7000-8000-000000000009",
);
const knowledgeIdentity: AuthenticatedIdentity = {
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
    context.set("identity", knowledgeIdentity);
    await next();
  });
}

function buildKnowledgeApp(dependencies: {
  profileRepository: ProfileRepository;
  memoryRepository: MemoryRepository;
  peopleRepository: PeopleRepository;
  wikiRepository: WikiRepository;
  revisionRepository: RevisionRepository;
  knowledgeSearchRepository: KnowledgeSearchRepository;
  knowledgeConflictService: KnowledgeConflictService;
  knowledgeUpkeepScanner?: WikiUpkeepScanner;
}) {
  const app = new Hono<{ Variables: AuthVariables }>();
  withErrorMapping(app);
  withIdentity(app);
  registerKnowledgeRoutes(app, dependencies);
  return app;
}

describe("knowledge routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("manages profile, memories, people, and wiki resources", async () => {
    const profile = {
      ownerId,
      id: asId<"profile">("01900000-0000-7000-8000-000000000010"),
      content: { values: { hello: "world" } },
      currentRevision: 1,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    };
    const profileUpdated = {
      ...profile,
      content: { values: { hello: "town" } },
      currentRevision: 2,
    };
    const profileHistory = {
      id: asId<"knowledge-revision">("01900000-0000-7000-8000-000000000020"),
      ownerId,
      resourceType: "profile" as const,
      resourceId: profile.id,
      revision: 1,
      baseRevision: 0,
      authorType: "user" as const,
      snapshot: { content: { values: { hello: "world" } } },
      citations: [],
      changeReason: null,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    };
    const memory = {
      id: memoryId,
      ownerId,
      scope: "global" as const,
      routineId: null,
      content: "town memory",
      status: "active" as const,
      confidence: 0.7,
      observedAt: new Date("2026-08-02T00:00:00.000Z"),
      expiresAt: null,
      currentRevision: 2,
      createdAt: new Date("2026-08-01T01:00:00.000Z"),
      updatedAt: new Date("2026-08-01T01:00:00.000Z"),
    };
    const memoryUpdated = {
      ...memory,
      status: "stale" as const,
      confidence: 0.2,
      updatedAt: new Date("2026-08-03T01:00:00.000Z"),
    };
    const person = {
      id: personId,
      ownerId,
      displayName: "Ada Lovelace",
      primaryEmail: "ada@example.test",
      category: "personal" as const,
      organization: "Computing",
      role: "Research",
      notes: "prototype",
      status: "active" as const,
      currentRevision: 4,
      createdAt: new Date("2026-08-01T02:00:00.000Z"),
      updatedAt: new Date("2026-08-01T02:00:00.000Z"),
    };
    const relationship = {
      id: personRelId,
      ownerId,
      personId,
      relatedPersonId,
      relationshipType: "mentor",
      notes: "legacy",
      status: "active" as const,
      revision: 2,
      createdAt: new Date("2026-08-01T03:00:00.000Z"),
      updatedAt: new Date("2026-08-01T03:00:00.000Z"),
    };
    const wiki = {
      id: wikiId,
      ownerId,
      kind: "goal" as const,
      slug: "goal-01",
      title: "Team goal",
      body: "Build cleanroom",
      status: "active" as const,
      currentRevision: 3,
      createdAt: new Date("2026-08-01T04:00:00.000Z"),
      updatedAt: new Date("2026-08-01T04:00:00.000Z"),
    };
    const profileRepository = {
      get: vi.fn().mockResolvedValue(profile),
      create: vi.fn().mockResolvedValue(profile),
      update: vi.fn().mockResolvedValue(profileUpdated),
      history: vi.fn().mockResolvedValue([profileHistory]),
    } as unknown as ProfileRepository;
    const memoryRepository = {
      list: vi.fn().mockResolvedValue([memory]),
      get: vi.fn().mockResolvedValue(memory),
      create: vi.fn().mockResolvedValue(memory),
      update: vi
        .fn()
        .mockResolvedValue({ kind: "applied", memory: memoryUpdated }),
      retire: vi
        .fn()
        .mockResolvedValue({ ...memoryUpdated, status: "retired" as const }),
    } as unknown as MemoryRepository;
    const peopleRepository = {
      list: vi.fn().mockResolvedValue([person]),
      get: vi.fn().mockResolvedValue(person),
      listRelationships: vi.fn().mockResolvedValue([relationship]),
      createRelationship: vi.fn().mockResolvedValue(relationship),
      updateRelationship: vi
        .fn()
        .mockResolvedValue({ ...relationship, relationshipType: "buddy" }),
      retireRelationship: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue(person),
      update: vi.fn().mockResolvedValue({ kind: "applied", person }),
    } as unknown as PeopleRepository;
    const wikiRepository = {
      list: vi.fn().mockResolvedValue([wiki]),
      get: vi.fn().mockResolvedValue(wiki),
      create: vi.fn().mockResolvedValue(wiki),
      update: vi
        .fn()
        .mockResolvedValue({ kind: "applied", document: wiki } as never),
    } as unknown as WikiRepository;

    const revisionRepository = {
      list: vi.fn().mockResolvedValue([profileHistory]),
    } as unknown as RevisionRepository;

    const knowledgeSearchRepository = {
      search: vi.fn().mockResolvedValue({
        items: [
          {
            ownerId,
            resourceType: "memory" as const,
            resourceId: memoryId,
            title: null,
            text: "town memory",
            subtype: null,
            status: "active",
            score: 0.99,
            updatedAt: new Date("2026-08-01T00:00:00.000Z"),
            citations: [],
            source: {
              kind: "local_postgresql" as const,
              algorithm: "postgres_full_text_v1" as const,
            },
          },
        ],
        nextCursor: null,
      }),
    } as unknown as KnowledgeSearchRepository;

    const knowledgeConflictService = {
      list: vi.fn().mockResolvedValue([
        {
          id: conflictId,
          ownerId,
          resourceType: "memory" as const,
          resourceId: memoryId,
          baseRevision: 1,
          currentRevision: 2,
          proposedAuthorType: "assistant" as const,
          proposedSnapshot: { x: "y" },
          proposedCitations: [],
          status: "pending" as const,
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
          resolvedAt: null,
        },
      ]),
      resolve: vi.fn().mockResolvedValue({
        id: conflictId,
        ownerId,
        resourceType: "memory" as const,
        resourceId: memoryId,
        baseRevision: 1,
        currentRevision: 2,
        proposedAuthorType: "assistant" as const,
        proposedSnapshot: { x: "y" },
        proposedCitations: [],
        status: "resolved" as const,
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        resolvedAt: new Date("2026-08-02T00:00:00.000Z"),
      }),
    } as unknown as KnowledgeConflictService;

    const createContextBuilder = vi.spyOn(
      knowledge,
      "createKnowledgeContextBuilder",
    );
    createContextBuilder.mockReturnValue({
      build: vi.fn().mockResolvedValue({
        context: "assembled",
        count: 2,
      }),
    } as never);

    const app = buildKnowledgeApp({
      profileRepository,
      memoryRepository,
      peopleRepository,
      wikiRepository,
      revisionRepository,
      knowledgeSearchRepository,
      knowledgeConflictService,
    });

    const profileResponse = await app.request("/v1/profile");
    const profileCreate = await app.request("/v1/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: { hello: "town" },
      }),
    });
    const profileUpdate = await app.request("/v1/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: { hello: "town" },
        expectedRevision: 1,
      }),
    });
    const profileHistoryResponse = await app.request("/v1/profile/history");

    const memoriesList = await app.request("/v1/memories");
    const memoryGet = await app.request(`/v1/memories/${memoryId}`);
    const memoryCreate = await app.request("/v1/memories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scope: "global",
        content: "town memory",
      }),
    });
    const memoryUpdate = await app.request(`/v1/memories/${memoryId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scope: "global",
        content: "town memory edited",
        confidence: 0.2,
        status: "stale",
        observedAt: "2026-08-03T00:00:00.000Z",
        expectedRevision: 2,
      }),
    });
    const memoryDelete = await app.request(
      `/v1/memories/${memoryId}?expectedRevision=2`,
      { method: "DELETE" },
    );

    const peopleList = await app.request("/v1/people");
    const peopleGet = await app.request(`/v1/people/${personId}`);
    const relationshipsGet = await app.request(
      `/v1/people/${personId}/relationships`,
    );
    const relationshipCreate = await app.request(
      `/v1/people/${personId}/relationships`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          relatedPersonId,
          relationshipType: "mentor",
          notes: "legacy",
        }),
      },
    );
    const relationshipUpdate = await app.request(
      `/v1/people/relationships/${personRelId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          relatedPersonId,
          relationshipType: "buddy",
          notes: "legacy",
          expectedRevision: 2,
        }),
      },
    );
    const peopleCreate = await app.request("/v1/people", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "Ada Lovelace",
        category: "personal",
        notes: "prototype",
      }),
    });
    const peopleUpdate = await app.request(`/v1/people/${personId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "Ada",
        category: "personal",
        notes: "prototype",
        primaryEmail: "ada@example.test",
        expectedRevision: 3,
      }),
    });
    const relationshipDelete = await app.request(
      `/v1/people/relationships/${personRelId}?expectedRevision=2`,
      { method: "DELETE" },
    );

    const wikiList = await app.request("/v1/wiki");
    const wikiGet = await app.request(`/v1/wiki/${wikiId}`);
    const wikiRevisions = await app.request(`/v1/wiki/${wikiId}/revisions`);
    const wikiCreate = await app.request("/v1/wiki", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "goal",
        slug: "goal-01",
        title: "Team goal",
        body: "Build cleanroom",
      }),
    });
    const wikiUpdate = await app.request(`/v1/wiki/${wikiId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "goal",
        slug: "goal-01",
        title: "Team goal",
        body: "Build cleanroom v2",
        expectedRevision: 3,
      }),
    });

    const knowledgeSearch = await app.request(
      "/v1/knowledge/search?q=town%20memory&memoryScope=routine&routineId=" +
        encodeURIComponent(routineId),
    );
    const knowledgeContext = await app.request(
      "/v1/knowledge/context?q=town&types=memory,person&limit=5&maxChars=2000",
    );
    const conflicts = await app.request("/v1/knowledge/conflicts");
    const resolveConflict = await app.request(
      `/v1/knowledge/conflicts/${conflictId}/resolve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedRevision: 1,
          resolution: "accept",
        }),
      },
    );

    expect(profileResponse.status).toBe(200);
    expect(profileCreate.status).toBe(201);
    expect(profileUpdate.status).toBe(200);
    expect(profileHistoryResponse.status).toBe(200);
    expect(await profileResponse.json()).toMatchObject({
      profile: {
        id: profile.id,
        ownerId,
        content: { values: { hello: "world" } },
      },
    });
    expect(await profileCreate.json()).toMatchObject({
      profile: {
        id: profile.id,
        ownerId,
        content: { values: { hello: "world" } },
      },
    });
    expect(await profileUpdate.json()).toMatchObject({
      id: profile.id,
      ownerId,
      content: { values: { hello: "town" } },
    });

    expect(memoriesList.status).toBe(200);
    expect(await memoriesList.json()).toMatchObject({
      memories: [
        {
          id: memoryId,
          ownerId,
          content: "town memory",
          scope: "global",
        },
      ],
    });
    expect(memoryGet.status).toBe(200);
    expect(await memoryGet.json()).toMatchObject({
      memory: {
        id: memoryId,
        ownerId,
        content: "town memory",
        scope: "global",
      },
    });
    expect(memoryCreate.status).toBe(201);
    expect(await memoryCreate.json()).toMatchObject({
      memory: {
        id: memoryId,
        ownerId,
        scope: "global",
        content: "town memory",
        status: "active",
      },
    });
    expect(memoryUpdate.status).toBe(200);
    expect(await memoryUpdate.json()).toMatchObject({
      kind: "applied",
      memory: {
        id: memoryId,
        ownerId,
        scope: "global",
        content: "town memory",
        status: "stale",
        confidence: 0.2,
      },
    });
    expect(memoryDelete.status).toBe(200);

    expect(peopleList.status).toBe(200);
    expect(await peopleList.json()).toMatchObject({
      people: [{ id: personId, displayName: "Ada Lovelace", ownerId }],
    });
    expect(peopleGet.status).toBe(200);
    expect(relationshipDelete.status).toBe(204);
    expect(await peopleGet.json()).toMatchObject({
      person: {
        id: personId,
        ownerId,
        displayName: "Ada Lovelace",
        category: "personal",
        status: "active",
      },
    });
    expect(relationshipsGet.status).toBe(200);
    expect(await relationshipsGet.json()).toMatchObject({
      relationships: [
        {
          id: personRelId,
          ownerId,
          personId,
          relatedPersonId,
          relationshipType: "mentor",
          status: "active",
        },
      ],
    });
    expect(relationshipCreate.status).toBe(201);
    expect(relationshipUpdate.status).toBe(200);
    expect(await relationshipCreate.json()).toMatchObject({
      relationship: expect.objectContaining({
        id: personRelId,
        ownerId,
        personId,
        relatedPersonId,
        relationshipType: "mentor",
        notes: "legacy",
        status: "active",
        revision: 2,
      }),
    });
    expect(await relationshipUpdate.json()).toMatchObject({
      relationship: expect.objectContaining({
        id: personRelId,
        ownerId,
        personId,
        relatedPersonId,
        relationshipType: "buddy",
        notes: "legacy",
        status: "active",
      }),
    });
    expect(peopleCreate.status).toBe(201);
    expect(peopleUpdate.status).toBe(200);

    expect(wikiList.status).toBe(200);
    expect(await wikiList.json()).toMatchObject({
      documents: [{ id: wikiId, ownerId, kind: "goal", slug: "goal-01" }],
    });
    expect(wikiGet.status).toBe(200);
    expect(await wikiGet.json()).toMatchObject({
      document: expect.objectContaining({
        id: wikiId,
        ownerId,
        kind: "goal",
        slug: "goal-01",
        title: "Team goal",
        body: "Build cleanroom",
        status: "active",
        currentRevision: 3,
      }),
    });
    expect(wikiRevisions.status).toBe(200);
    expect(await wikiRevisions.json()).toMatchObject({
      revisions: [
        {
          ownerId,
          resourceType: "profile",
          resourceId: profile.id,
          revision: 1,
          baseRevision: 0,
        },
      ],
    });
    expect(wikiCreate.status).toBe(201);
    expect(wikiUpdate.status).toBe(200);

    expect(knowledgeSearch.status).toBe(200);
    expect(await knowledgeSearch.json()).toMatchObject({
      items: [{ resourceType: "memory" }],
      nextCursor: null,
    });
    expect(createContextBuilder).toHaveBeenCalledWith(
      knowledgeSearchRepository,
    );
    expect(knowledgeContext.status).toBe(200);
    expect(await knowledgeContext.json()).toMatchObject({
      context: "assembled",
    });

    expect(conflicts.status).toBe(200);
    expect(resolveConflict.status).toBe(200);
    expect(knowledgeConflictService.resolve).toHaveBeenCalledWith({
      ownerId,
      conflictId,
      expectedRevision: 1,
      resolution: "accept",
    });

    expect(memoryRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId,
        scope: "global",
        content: "town memory",
        status: "active",
      }),
    );
    expect(memoryRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId,
        memoryId,
        scope: "global",
        expectedRevision: 2,
      }),
    );
    expect(knowledgeSearchRepository.search).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId,
        query: "town memory",
        memoryScope: { scope: "routine", routineId },
      }),
    );
    expect(profileRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId, expectedRevision: 1 }),
    );
  });

  it("validates knowledge search query constraints", async () => {
    const app = buildKnowledgeApp({
      profileRepository: {
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        history: vi.fn(),
      } as unknown as ProfileRepository,
      memoryRepository: {
        list: vi.fn(),
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        retire: vi.fn(),
      } as unknown as MemoryRepository,
      peopleRepository: {
        list: vi.fn(),
        get: vi.fn(),
        listRelationships: vi.fn(),
        createRelationship: vi.fn(),
        updateRelationship: vi.fn(),
        retireRelationship: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      } as unknown as PeopleRepository,
      wikiRepository: {
        list: vi.fn(),
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      } as unknown as WikiRepository,
      revisionRepository: { list: vi.fn() } as unknown as RevisionRepository,
      knowledgeSearchRepository: {
        search: vi.fn(),
      } as unknown as KnowledgeSearchRepository,
      knowledgeConflictService: {
        list: vi.fn(),
        resolve: vi.fn(),
      } as unknown as KnowledgeConflictService,
      knowledgeUpkeepScanner: {
        scan: vi.fn(),
      } as unknown as WikiUpkeepScanner,
    });

    const invalidScope = await app.request(
      "/v1/knowledge/search?q=abc&memoryScope=global&routineId=" +
        relatedPersonId,
    );
    const missingRoutine = await app.request(
      "/v1/knowledge/search?q=abc&memoryScope=routine",
    );

    expect(invalidScope.status).toBe(400);
    expect(missingRoutine.status).toBe(400);
    expect(await invalidScope.json()).toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(await missingRoutine.json()).toMatchObject({
      code: "INVALID_REQUEST",
    });
  });

  it("supports optional upkeep scanner and returns 503 when unavailable", async () => {
    const notConfigured = buildKnowledgeApp({
      profileRepository: { get: vi.fn() } as unknown as ProfileRepository,
      memoryRepository: {} as unknown as MemoryRepository,
      peopleRepository: {} as unknown as PeopleRepository,
      wikiRepository: {} as unknown as WikiRepository,
      revisionRepository: {} as unknown as RevisionRepository,
      knowledgeSearchRepository: {} as unknown as KnowledgeSearchRepository,
      knowledgeConflictService: {} as unknown as KnowledgeConflictService,
    });
    const miss = await notConfigured.request("/v1/knowledge/upkeep");
    expect(miss.status).toBe(503);
    expect(await miss.json()).toMatchObject({ code: "UPKEEP_NOT_CONFIGURED" });

    const scan = vi
      .fn()
      .mockResolvedValue({ items: [], nextCursor: null, staleCount: 0 });
    const configured = buildKnowledgeApp({
      profileRepository: { get: vi.fn() } as unknown as ProfileRepository,
      memoryRepository: {} as unknown as MemoryRepository,
      peopleRepository: {} as unknown as PeopleRepository,
      wikiRepository: {} as unknown as WikiRepository,
      revisionRepository: {} as unknown as RevisionRepository,
      knowledgeSearchRepository: {} as unknown as KnowledgeSearchRepository,
      knowledgeConflictService: {} as unknown as KnowledgeConflictService,
      knowledgeUpkeepScanner: { scan } as unknown as WikiUpkeepScanner,
    });
    const ok = await configured.request(
      "/v1/knowledge/upkeep?staleAfterDays=7&limit=10",
    );

    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      items: [],
      nextCursor: null,
      staleCount: 0,
    });
    expect(scan).toHaveBeenCalledWith({
      ownerId,
      staleAfterDays: 7,
      limit: 10,
    });
  });
});
