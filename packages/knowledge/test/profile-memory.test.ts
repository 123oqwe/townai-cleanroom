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
import { createProfileRepository } from "../src/profile-repository.js";
import { createRevisionRepository } from "../src/revision-repository.js";

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
      (${ownerId}, 'profile-owner@example.invalid', 'UTC'),
      (${otherOwnerId}, 'profile-other@example.invalid', 'UTC')
  `;
});

afterAll(async () => {
  await sql.end();
});

describe("profile repository", () => {
  it("keeps one owner-isolated profile with immutable cited revisions", async () => {
    const profiles = createProfileRepository(sql);
    const created = await profiles.create({
      ownerId,
      content: {
        identity: { role: "Founder" },
        communication: { style: "concise" },
      },
      authorType: "user",
      citations: [
        {
          sourceType: "user",
          sourceRef: "profile-editor",
          observedAt: new Date("2026-08-02T00:00:00.000Z"),
        },
      ],
    });

    await expect(
      profiles.create({
        ownerId,
        content: { identity: { role: "Duplicate" } },
        authorType: "user",
        citations: [],
      }),
    ).rejects.toMatchObject({ code: "PROFILE_ALREADY_EXISTS" });
    await expect(profiles.get(otherOwnerId)).rejects.toMatchObject({
      code: "PROFILE_NOT_FOUND",
    });

    const updated = await profiles.update({
      ownerId,
      expectedRevision: 1,
      content: {
        identity: { role: "CEO" },
        communication: { style: "concise" },
      },
      authorType: "user",
      citations: [
        {
          sourceType: "user",
          sourceRef: "profile-correction",
          observedAt: new Date("2026-08-02T01:00:00.000Z"),
        },
      ],
    });

    expect(created).toMatchObject({ ownerId, currentRevision: 1 });
    expect(updated).toMatchObject({
      kind: "applied",
      profile: {
        ownerId,
        currentRevision: 2,
        content: { identity: { role: "CEO" } },
      },
    });
    await expect(profiles.history(ownerId)).resolves.toMatchObject([
      { revision: 1, citations: [{ sourceRef: "profile-editor" }] },
      { revision: 2, citations: [{ sourceRef: "profile-correction" }] },
    ]);
  });

  it("records stale assistant profile updates as conflicts without overwriting", async () => {
    const profiles = createProfileRepository(sql);
    await profiles.create({
      ownerId,
      content: { identity: { role: "Founder" } },
      authorType: "assistant",
      citations: [],
    });
    await profiles.update({
      ownerId,
      expectedRevision: 1,
      content: { identity: { role: "CEO" } },
      authorType: "user",
      citations: [],
    });

    const result = await profiles.update({
      ownerId,
      expectedRevision: 1,
      content: { identity: { role: "Outdated inference" } },
      authorType: "assistant",
      citations: [],
    });

    expect(result).toMatchObject({ kind: "conflict" });
    await expect(profiles.get(ownerId)).resolves.toMatchObject({
      currentRevision: 2,
      content: { identity: { role: "CEO" } },
    });
  });
});

describe("memory repository", () => {
  it("validates global and routine scope and lists deterministically", async () => {
    const memories = createMemoryRepository(sql);
    const routineId = newId<"routine">();
    const observedAt = new Date("2026-08-02T00:00:00.000Z");
    const global = await memories.create({
      ownerId,
      scope: "global",
      content: "Prefers concise answers",
      status: "active",
      observedAt,
      authorType: "user",
      citations: [],
    });
    const routine = await memories.create({
      ownerId,
      scope: "routine",
      routineId,
      content: "Include weather in the morning briefing",
      status: "active",
      observedAt,
      expiresAt: new Date("2026-12-01T00:00:00.000Z"),
      authorType: "user",
      citations: [],
    });

    await expect(
      memories.create({
        ownerId,
        scope: "routine",
        content: "Missing routine ID",
        status: "active",
        observedAt,
        authorType: "user",
        citations: [],
      } as never),
    ).rejects.toThrow();
    await expect(
      memories.create({
        ownerId,
        scope: "global",
        routineId,
        content: "Global must not bind a routine",
        status: "active",
        observedAt,
        authorType: "user",
        citations: [],
      } as never),
    ).rejects.toThrow();

    await expect(memories.list(ownerId)).resolves.toEqual([global, routine]);
    await expect(
      memories.list(ownerId, { scope: "routine", routineId }),
    ).resolves.toEqual([routine]);
    await expect(memories.list(otherOwnerId)).resolves.toEqual([]);
  });

  it("updates freshness and status while preserving cited history", async () => {
    const memories = createMemoryRepository(sql);
    const revisions = createRevisionRepository(sql);
    const memory = await memories.create({
      ownerId,
      scope: "global",
      content: "Works on Project North",
      status: "active",
      confidence: 0.8,
      observedAt: new Date("2026-08-01T00:00:00.000Z"),
      authorType: "assistant",
      citations: [
        {
          sourceType: "session",
          sourceRef: "session-observation",
          observedAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      ],
    });

    const updated = await memories.update({
      ownerId,
      memoryId: memory.id,
      expectedRevision: 1,
      scope: "global",
      content: "Project North is no longer active",
      status: "stale",
      confidence: 1,
      observedAt: new Date("2026-08-02T00:00:00.000Z"),
      authorType: "user",
      citations: [
        {
          sourceType: "user",
          sourceRef: "memory-correction",
          observedAt: new Date("2026-08-02T00:00:00.000Z"),
        },
      ],
    });

    expect(updated).toMatchObject({
      kind: "applied",
      memory: {
        currentRevision: 2,
        status: "stale",
        content: "Project North is no longer active",
      },
    });
    await expect(
      revisions.list(ownerId, "memory", memory.id),
    ).resolves.toMatchObject([
      { revision: 1, citations: [{ sourceRef: "session-observation" }] },
      { revision: 2, citations: [{ sourceRef: "memory-correction" }] },
    ]);
  });

  it("retires or removes a memory without deleting revision history", async () => {
    const memories = createMemoryRepository(sql);
    const revisions = createRevisionRepository(sql);
    const memory = await memories.create({
      ownerId,
      scope: "global",
      content: "Temporary preference",
      status: "active",
      observedAt: new Date("2026-08-02T00:00:00.000Z"),
      authorType: "user",
      citations: [],
    });

    const retired = await memories.retire({
      ownerId,
      memoryId: memory.id,
      expectedRevision: 1,
      authorType: "user",
      citations: [],
    });
    expect(retired).toMatchObject({ status: "retired", currentRevision: 2 });

    await memories.remove(ownerId, memory.id);

    await expect(memories.get(ownerId, memory.id)).rejects.toMatchObject({
      code: "MEMORY_NOT_FOUND",
    });
    await expect(
      revisions.list(ownerId, "memory", memory.id),
    ).resolves.toHaveLength(2);
  });
});
