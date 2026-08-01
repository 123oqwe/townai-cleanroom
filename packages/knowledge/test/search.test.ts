import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
} from "vitest";
import postgres, { type Sql } from "postgres";

import { newId, type Id } from "@town/contracts";
import { runMigrations } from "@town/db";

import { createMemoryRepository } from "../src/memory-repository.js";
import { createPeopleRepository } from "../src/people-repository.js";
import { createKnowledgeSearchRepository } from "../src/search-repository.js";
import { createWikiRepository } from "../src/wiki-repository.js";

let sql: Sql;
let ownerId: Id<"user">;
let otherOwnerId: Id<"user">;

beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 1 });
  await runMigrations(sql);
});

beforeEach(async () => {
  await sql`truncate table users cascade`;
  ownerId = newId<"user">();
  otherOwnerId = newId<"user">();
  await sql`
    insert into users (id, email, timezone)
    values
      (${ownerId}, 'search-owner@example.invalid', 'UTC'),
      (${otherOwnerId}, 'search-other@example.invalid', 'UTC')
  `;
});

afterAll(async () => {
  await sql.end();
});

describe("local knowledge search", () => {
  it("searches current owner knowledge with citations and explicit local source", async () => {
    const memories = createMemoryRepository(sql);
    const people = createPeopleRepository(sql);
    const wiki = createWikiRepository(sql);
    const search = createKnowledgeSearchRepository(sql);
    await memories.create({
      ownerId,
      scope: "global",
      content: "The launch checklist must stay concise",
      status: "active",
      observedAt: new Date("2026-08-02T00:00:00.000Z"),
      authorType: "user",
      citations: [
        {
          sourceType: "user",
          sourceRef: "memory-editor",
          observedAt: new Date("2026-08-02T00:00:00.000Z"),
        },
      ],
    });
    await people.create({
      ownerId,
      displayName: "Launch Partner",
      category: "coworker",
      notes: "Coordinates the product launch",
      authorType: "user",
      citations: [],
    });
    await wiki.create({
      ownerId,
      kind: "project",
      slug: "launch-project",
      title: "Launch Project",
      body: "Verified launch plan",
      authorType: "user",
      citations: [],
    });
    await wiki.create({
      ownerId: otherOwnerId,
      kind: "project",
      slug: "private-launch",
      title: "Other Owner Launch",
      body: "Must not be returned",
      authorType: "user",
      citations: [],
    });

    const page = await search.search({ ownerId, query: "launch", limit: 10 });

    expect(page.items).toHaveLength(3);
    expect(
      page.items.every(({ ownerId: resultOwner }) => resultOwner === ownerId),
    ).toBe(true);
    expect(
      page.items.every(({ source }) => source.kind === "local_postgresql"),
    ).toBe(true);
    expect(
      page.items.find(({ resourceType }) => resourceType === "memory"),
    ).toMatchObject({ citations: [{ sourceRef: "memory-editor" }] });
  });

  it("filters by resource type and routine memory scope", async () => {
    const memories = createMemoryRepository(sql);
    const wiki = createWikiRepository(sql);
    const search = createKnowledgeSearchRepository(sql);
    const routineId = newId<"routine">();
    await memories.create({
      ownerId,
      scope: "global",
      content: "Briefing preference for every workflow",
      status: "active",
      observedAt: new Date(),
      authorType: "user",
      citations: [],
    });
    const routineMemory = await memories.create({
      ownerId,
      scope: "routine",
      routineId,
      content: "Briefing preference for the morning routine",
      status: "active",
      observedAt: new Date(),
      authorType: "user",
      citations: [],
    });
    await wiki.create({
      ownerId,
      kind: "page",
      slug: "briefing",
      title: "Briefing",
      body: "Briefing documentation",
      authorType: "user",
      citations: [],
    });

    const result = await search.search({
      ownerId,
      query: "briefing",
      types: ["memory"],
      memoryScope: { scope: "routine", routineId },
      limit: 10,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      resourceId: routineMemory.id,
      resourceType: "memory",
      subtype: "routine",
    });
  });

  it("excludes inactive knowledge by default", async () => {
    const wiki = createWikiRepository(sql);
    const search = createKnowledgeSearchRepository(sql);
    const document = await wiki.create({
      ownerId,
      kind: "project",
      slug: "retired-roadmap",
      title: "Retired Roadmap",
      body: "Archived roadmap details",
      authorType: "user",
      citations: [],
    });
    await wiki.retire({
      ownerId,
      documentId: document.id,
      expectedRevision: 1,
      authorType: "user",
      citations: [],
    });

    await expect(
      search.search({ ownerId, query: "roadmap", limit: 10 }),
    ).resolves.toMatchObject({ items: [] });
    await expect(
      search.search({
        ownerId,
        query: "roadmap",
        includeInactive: true,
        limit: 10,
      }),
    ).resolves.toMatchObject({
      items: [{ resourceId: document.id, status: "retired" }],
    });
  });

  it("paginates a stable rank without duplicates", async () => {
    const wiki = createWikiRepository(sql);
    const search = createKnowledgeSearchRepository(sql);
    for (let index = 0; index < 5; index += 1) {
      await wiki.create({
        ownerId,
        kind: "page",
        slug: `alpha-${index}`,
        title: `Alpha ${index}`,
        body: "Alpha search fixture",
        authorType: "user",
        citations: [],
      });
    }

    const first = await search.search({ ownerId, query: "alpha", limit: 2 });
    if (first.nextCursor === null) throw new Error("Expected first cursor.");
    const second = await search.search({
      ownerId,
      query: "alpha",
      limit: 2,
      cursor: first.nextCursor,
    });
    if (second.nextCursor === null) throw new Error("Expected second cursor.");
    const third = await search.search({
      ownerId,
      query: "alpha",
      limit: 2,
      cursor: second.nextCursor,
    });
    const ids = [...first.items, ...second.items, ...third.items].map(
      ({ resourceId }) => resourceId,
    );

    expect(first.nextCursor).toBeTypeOf("string");
    expect(second.nextCursor).toBeTypeOf("string");
    expect(third.nextCursor).toBeNull();
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    await expect(
      search.search({
        ownerId,
        query: "different-query",
        limit: 2,
        cursor: first.nextCursor,
      }),
    ).rejects.toMatchObject({ code: "CURSOR_MISMATCH" });
  });

  it("rejects empty queries and malformed cursors", async () => {
    const search = createKnowledgeSearchRepository(sql);

    await expect(
      search.search({ ownerId, query: "   ", limit: 10 }),
    ).rejects.toThrow();
    await expect(
      search.search({
        ownerId,
        query: "valid",
        cursor: "not-a-cursor",
        limit: 10,
      }),
    ).rejects.toThrow();
  });
});
