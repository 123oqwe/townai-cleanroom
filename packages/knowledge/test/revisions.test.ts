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
  sql = postgres(inject("postgresUrl"), { max: 4 });
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

  it("rejects a citation bound to another owner's account", async () => {
    const repository = createRevisionRepository(sql);
    const otherAccountId = newId<"connected-account">();
    await sql`
      insert into connected_accounts (
        id, owner_id, provider, provider_user_id, email, capabilities
      ) values (
        ${otherAccountId}, ${otherOwnerId}, 'google', 'other-account',
        'other-account@example.invalid', '{}'::jsonb
      )
    `;

    await expect(
      repository.createInitial({
        ownerId,
        resourceType: "person",
        resourceId: newId<"person">(),
        authorType: "assistant",
        snapshot: { displayName: "Cross-owner citation" },
        citations: [
          {
            sourceType: "account",
            sourceRef: "provider-record",
            accountId: otherAccountId,
            observedAt: new Date("2026-08-02T00:00:00.000Z"),
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "CITATION_ACCOUNT_MISMATCH" });
  });

  it("rejects a stale proposal citing another owner's account", async () => {
    const repository = createRevisionRepository(sql);
    const resourceId = newId<"wiki">();
    const otherAccountId = newId<"connected-account">();
    await sql`
      insert into connected_accounts (
        id, owner_id, provider, provider_user_id, email, capabilities
      ) values (
        ${otherAccountId}, ${otherOwnerId}, 'google', 'other-stale-account',
        'other-stale-account@example.invalid', '{}'::jsonb
      )
    `;
    await repository.createInitial({
      ownerId,
      resourceType: "wiki",
      resourceId,
      authorType: "user",
      snapshot: { body: "Initial" },
      citations: [],
    });
    await repository.append({
      ownerId,
      resourceType: "wiki",
      resourceId,
      expectedRevision: 1,
      authorType: "user",
      snapshot: { body: "Owner edit" },
      citations: [],
    });

    await expect(
      repository.append({
        ownerId,
        resourceType: "wiki",
        resourceId,
        expectedRevision: 1,
        authorType: "assistant",
        snapshot: { body: "Stale proposal" },
        citations: [
          {
            sourceType: "account",
            sourceRef: "cross-owner-provider-record",
            accountId: otherAccountId,
            observedAt: new Date("2026-08-02T00:00:00.000Z"),
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "CITATION_ACCOUNT_MISMATCH" });
    await expect(repository.listConflicts(ownerId)).resolves.toEqual([]);
  });

  it("serializes concurrent user appends into one revision conflict", async () => {
    const repository = createRevisionRepository(sql);
    const resourceId = newId<"memory">();
    await repository.createInitial({
      ownerId,
      resourceType: "memory",
      resourceId,
      authorType: "user",
      snapshot: { content: "Initial" },
      citations: [],
    });

    const results = await Promise.allSettled([
      repository.append({
        ownerId,
        resourceType: "memory",
        resourceId,
        expectedRevision: 1,
        authorType: "user",
        snapshot: { content: "First edit" },
        citations: [],
      }),
      repository.append({
        ownerId,
        resourceType: "memory",
        resourceId,
        expectedRevision: 1,
        authorType: "user",
        snapshot: { content: "Second edit" },
        citations: [],
      }),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { code: "REVISION_CONFLICT" },
    });
  });

  it("serializes concurrent user and assistant appends without storage errors", async () => {
    const repository = createRevisionRepository(sql);
    const resourceId = newId<"wiki">();
    await repository.createInitial({
      ownerId,
      resourceType: "wiki",
      resourceId,
      authorType: "user",
      snapshot: { body: "Initial" },
      citations: [],
    });

    const results = await Promise.allSettled([
      repository.append({
        ownerId,
        resourceType: "wiki",
        resourceId,
        expectedRevision: 1,
        authorType: "user",
        snapshot: { body: "Owner edit" },
        citations: [],
      }),
      repository.append({
        ownerId,
        resourceType: "wiki",
        resourceId,
        expectedRevision: 1,
        authorType: "assistant",
        snapshot: { body: "Assistant proposal" },
        citations: [],
      }),
    ]);

    const fulfilled = results.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof repository.append>>
      > => result.status === "fulfilled",
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(fulfilled.some(({ value }) => value.kind === "applied")).toBe(true);
    if (rejected.length === 0) {
      expect(fulfilled.map(({ value }) => value.kind).sort()).toEqual([
        "applied",
        "conflict",
      ]);
      await expect(repository.listConflicts(ownerId)).resolves.toMatchObject([
        {
          status: "pending",
          proposedSnapshot: { body: "Assistant proposal" },
        },
      ]);
    } else {
      expect(rejected).toMatchObject([
        { reason: { code: "REVISION_CONFLICT" } },
      ]);
      await expect(repository.listConflicts(ownerId)).resolves.toEqual([]);
    }
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
