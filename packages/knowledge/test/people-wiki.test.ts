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

import { createPeopleRepository } from "../src/people-repository.js";
import { createRevisionRepository } from "../src/revision-repository.js";
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
      (${ownerId}, 'people-owner@example.invalid', 'UTC'),
      (${otherOwnerId}, 'people-other@example.invalid', 'UTC')
  `;
});

afterAll(async () => {
  await sql.end();
});

describe("people repository", () => {
  it("lists observed categories deterministically and isolates owners", async () => {
    const people = createPeopleRepository(sql);
    const uncategorized = await people.create({
      ownerId,
      displayName: "Alex Example",
      category: "uncategorized",
      notes: "",
      authorType: "user",
      citations: [],
    });
    const coworker = await people.create({
      ownerId,
      displayName: "Casey Coworker",
      primaryEmail: "casey@example.invalid",
      category: "coworker",
      notes: "Works on operations",
      authorType: "user",
      citations: [],
    });
    await people.create({
      ownerId,
      displayName: "Family Contact",
      category: "family",
      notes: "",
      authorType: "user",
      citations: [],
    });
    await people.create({
      ownerId,
      displayName: "Personal Contact",
      category: "personal",
      notes: "",
      authorType: "user",
      citations: [],
    });

    const all = await people.list(ownerId);
    expect(all.map(({ category }) => category)).toEqual([
      "uncategorized",
      "coworker",
      "family",
      "personal",
    ]);
    await expect(
      people.list(ownerId, { category: "coworker" }),
    ).resolves.toEqual([coworker]);
    await expect(people.list(otherOwnerId)).resolves.toEqual([]);
    await expect(
      people.get(otherOwnerId, uncategorized.id),
    ).rejects.toMatchObject({
      code: "PERSON_NOT_FOUND",
    });
  });

  it("requires provenance for assistant-inferred enrichment", async () => {
    const people = createPeopleRepository(sql);

    await expect(
      people.create({
        ownerId,
        displayName: "Unverified Relationship",
        primaryEmail: "unverified@example.invalid",
        category: "coworker",
        notes: "",
        authorType: "system",
        citations: [],
      }),
    ).rejects.toMatchObject({ code: "PROVENANCE_REQUIRED" });

    await expect(
      people.create({
        ownerId,
        displayName: "Unverified Contact",
        category: "coworker",
        organization: "Unverified Company",
        role: "Unverified Role",
        notes: "Inferred relationship",
        authorType: "assistant",
        citations: [],
      }),
    ).rejects.toMatchObject({ code: "PROVENANCE_REQUIRED" });

    await expect(
      people.create({
        ownerId,
        displayName: "Verified Contact",
        category: "coworker",
        organization: "Verified Company",
        role: "Verified Role",
        notes: "Observed collaboration",
        authorType: "assistant",
        citations: [
          {
            sourceType: "session",
            sourceRef: "contact-research-session",
            observedAt: new Date("2026-08-02T00:00:00.000Z"),
          },
        ],
      }),
    ).resolves.toMatchObject({
      organization: "Verified Company",
      role: "Verified Role",
      currentRevision: 1,
    });
  });

  it("updates and retires a person while preserving cited history", async () => {
    const people = createPeopleRepository(sql);
    const revisions = createRevisionRepository(sql);
    const person = await people.create({
      ownerId,
      displayName: "Jordan Example",
      category: "uncategorized",
      notes: "Initial note",
      authorType: "user",
      citations: [],
    });

    const updated = await people.update({
      ownerId,
      personId: person.id,
      expectedRevision: 1,
      displayName: "Jordan Example",
      category: "personal",
      organization: "Example Org",
      notes: "Corrected by owner",
      authorType: "user",
      citations: [
        {
          sourceType: "user",
          sourceRef: "people-editor",
          observedAt: new Date("2026-08-02T01:00:00.000Z"),
        },
      ],
    });
    expect(updated).toMatchObject({
      kind: "applied",
      person: { category: "personal", currentRevision: 2 },
    });

    const retired = await people.retire({
      ownerId,
      personId: person.id,
      expectedRevision: 2,
      authorType: "user",
      citations: [],
    });
    expect(retired).toMatchObject({ status: "retired", currentRevision: 3 });
    await expect(people.list(ownerId)).resolves.toEqual([]);
    await expect(
      revisions.list(ownerId, "person", person.id),
    ).resolves.toHaveLength(3);
  });
});

describe("wiki repository", () => {
  it("stores profile, goal, project, and page documents with unique slugs", async () => {
    const wiki = createWikiRepository(sql);
    const profile = await wiki.create({
      ownerId,
      kind: "profile",
      slug: "profile",
      title: "Profile",
      body: "Owner-maintained profile summary",
      authorType: "user",
      citations: [],
    });
    const goal = await wiki.create({
      ownerId,
      kind: "goal",
      slug: "launch",
      title: "Launch Goal",
      body: "Ship the verified product",
      authorType: "user",
      citations: [],
    });
    const project = await wiki.create({
      ownerId,
      kind: "project",
      slug: "town-clean-room",
      title: "Town Clean-Room",
      body: "Evidence-backed implementation",
      authorType: "user",
      citations: [],
    });
    const page = await wiki.create({
      ownerId,
      kind: "page",
      slug: "working-style",
      title: "Working Style",
      body: "Editable knowledge page",
      authorType: "user",
      citations: [],
    });

    await expect(wiki.list(ownerId)).resolves.toEqual([
      profile,
      goal,
      project,
      page,
    ]);
    await expect(wiki.list(ownerId, { kind: "project" })).resolves.toEqual([
      project,
    ]);
    await expect(
      wiki.create({
        ownerId,
        kind: "project",
        slug: "town-clean-room",
        title: "Duplicate",
        body: "Duplicate slug",
        authorType: "user",
        citations: [],
      }),
    ).rejects.toMatchObject({ code: "WIKI_DOCUMENT_ALREADY_EXISTS" });
  });

  it("protects a user edit from stale synthesis and preserves revisions", async () => {
    const wiki = createWikiRepository(sql);
    const revisions = createRevisionRepository(sql);
    const document = await wiki.create({
      ownerId,
      kind: "project",
      slug: "active-project",
      title: "Active Project",
      body: "Initial synthesis",
      authorType: "assistant",
      citations: [
        {
          sourceType: "system",
          sourceRef: "initial-profile-build",
          observedAt: new Date("2026-08-02T00:00:00.000Z"),
        },
      ],
    });
    await wiki.update({
      ownerId,
      documentId: document.id,
      expectedRevision: 1,
      kind: "project",
      slug: "active-project",
      title: "Active Project",
      body: "Owner correction",
      authorType: "user",
      citations: [],
    });

    const conflict = await wiki.update({
      ownerId,
      documentId: document.id,
      expectedRevision: 1,
      kind: "project",
      slug: "active-project",
      title: "Active Project",
      body: "Stale nightly synthesis",
      authorType: "system",
      citations: [
        {
          sourceType: "system",
          sourceRef: "nightly-upkeep",
          observedAt: new Date("2026-08-02T02:00:00.000Z"),
        },
      ],
    });

    expect(conflict).toMatchObject({ kind: "conflict" });
    await expect(wiki.get(ownerId, document.id)).resolves.toMatchObject({
      body: "Owner correction",
      currentRevision: 2,
    });
    await expect(
      revisions.list(ownerId, "wiki", document.id),
    ).resolves.toHaveLength(2);
  });
});
