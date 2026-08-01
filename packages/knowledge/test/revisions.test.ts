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

import {
  createRevisionRepository,
  RevisionError,
} from "../src/revision-repository.js";

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
      (${ownerId}, 'owner@example.invalid', 'UTC'),
      (${otherOwnerId}, 'other@example.invalid', 'UTC')
  `;
});

afterAll(async () => {
  await sql.end();
});

describe("knowledge revisions", () => {
  it("preserves immutable revisions and their citations", async () => {
    const repository = createRevisionRepository(sql);
    const resourceId = newId<"memory">();
    const initial = await repository.createInitial({
      ownerId,
      resourceType: "memory",
      resourceId,
      authorType: "user",
      snapshot: { content: "Prefers concise status updates" },
      citations: [
        {
          sourceType: "user",
          sourceRef: "manual-entry",
          observedAt: new Date("2026-08-02T00:00:00.000Z"),
        },
      ],
    });

    const updated = await repository.append({
      ownerId,
      resourceType: "memory",
      resourceId,
      expectedRevision: 1,
      authorType: "user",
      snapshot: { content: "Prefers concise weekly status updates" },
      citations: [
        {
          sourceType: "user",
          sourceRef: "manual-correction",
          observedAt: new Date("2026-08-02T01:00:00.000Z"),
        },
      ],
    });

    expect(initial.revision).toBe(1);
    expect(updated).toMatchObject({
      kind: "applied",
      revision: { revision: 2 },
    });
    await expect(
      repository.list(ownerId, "memory", resourceId),
    ).resolves.toMatchObject([
      {
        revision: 1,
        snapshot: { content: "Prefers concise status updates" },
        citations: [{ sourceRef: "manual-entry" }],
      },
      {
        revision: 2,
        snapshot: { content: "Prefers concise weekly status updates" },
        citations: [{ sourceRef: "manual-correction" }],
      },
    ]);
  });

  it("rejects stale user edits and cross-owner access", async () => {
    const repository = createRevisionRepository(sql);
    const resourceId = newId<"profile">();
    await repository.createInitial({
      ownerId,
      resourceType: "profile",
      resourceId,
      authorType: "user",
      snapshot: { role: "Founder" },
      citations: [],
    });
    await repository.append({
      ownerId,
      resourceType: "profile",
      resourceId,
      expectedRevision: 1,
      authorType: "user",
      snapshot: { role: "CEO" },
      citations: [],
    });

    await expect(
      repository.append({
        ownerId,
        resourceType: "profile",
        resourceId,
        expectedRevision: 1,
        authorType: "user",
        snapshot: { role: "CTO" },
        citations: [],
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(
      repository.list(otherOwnerId, "profile", resourceId),
    ).rejects.toBeInstanceOf(RevisionError);
  });

  it("records a stale assistant proposal as a conflict without overwriting", async () => {
    const repository = createRevisionRepository(sql);
    const resourceId = newId<"wiki">();
    await repository.createInitial({
      ownerId,
      resourceType: "wiki",
      resourceId,
      authorType: "assistant",
      snapshot: { title: "Projects", body: "Initial" },
      citations: [],
    });
    await repository.append({
      ownerId,
      resourceType: "wiki",
      resourceId,
      expectedRevision: 1,
      authorType: "user",
      snapshot: { title: "Projects", body: "User correction" },
      citations: [],
    });

    const result = await repository.append({
      ownerId,
      resourceType: "wiki",
      resourceId,
      expectedRevision: 1,
      authorType: "assistant",
      snapshot: { title: "Projects", body: "Stale synthesis" },
      citations: [
        {
          sourceType: "system",
          sourceRef: "nightly-upkeep",
          observedAt: new Date("2026-08-02T02:00:00.000Z"),
        },
      ],
    });

    expect(result).toMatchObject({
      kind: "conflict",
      conflict: { baseRevision: 1, currentRevision: 2, status: "pending" },
    });
    expect(await repository.list(ownerId, "wiki", resourceId)).toHaveLength(2);
    await expect(repository.listConflicts(ownerId)).resolves.toMatchObject([
      {
        proposedSnapshot: { title: "Projects", body: "Stale synthesis" },
        proposedCitations: [{ sourceRef: "nightly-upkeep" }],
      },
    ]);
  });

  it("validates citation/account binding before persistence", async () => {
    const repository = createRevisionRepository(sql);

    await expect(
      repository.createInitial({
        ownerId,
        resourceType: "person",
        resourceId: newId<"person">(),
        authorType: "assistant",
        snapshot: { displayName: "Verified contact" },
        citations: [
          {
            sourceType: "account",
            sourceRef: "provider-record",
            observedAt: new Date(),
          } as never,
        ],
      }),
    ).rejects.toThrow();
  });

  it("resolves a conflict only against the expected current revision", async () => {
    const repository = createRevisionRepository(sql);
    const resourceId = newId<"memory">();
    await repository.createInitial({
      ownerId,
      resourceType: "memory",
      resourceId,
      authorType: "assistant",
      snapshot: { content: "Initial" },
      citations: [],
    });
    await repository.append({
      ownerId,
      resourceType: "memory",
      resourceId,
      expectedRevision: 1,
      authorType: "user",
      snapshot: { content: "User edit" },
      citations: [],
    });
    const proposed = await repository.append({
      ownerId,
      resourceType: "memory",
      resourceId,
      expectedRevision: 1,
      authorType: "system",
      snapshot: { content: "Reviewed proposal" },
      citations: [],
    });
    if (proposed.kind !== "conflict") throw new Error("Expected conflict.");

    const resolved = await repository.resolveConflict({
      ownerId,
      conflictId: proposed.conflict.id,
      expectedRevision: 2,
      resolution: "accept",
    });

    expect(resolved).toMatchObject({
      kind: "resolved",
      revision: {
        revision: 3,
        baseRevision: 2,
        authorType: "user",
        snapshot: { content: "Reviewed proposal" },
      },
    });
    await expect(repository.listConflicts(ownerId)).resolves.toMatchObject([
      { status: "resolved", resolvedAt: expect.any(Date) },
    ]);
  });
});
