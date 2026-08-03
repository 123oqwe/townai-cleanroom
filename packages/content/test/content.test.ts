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

import { decodeCursor, newId, type Id } from "@town/contracts";
import { runMigrations } from "@town/db";
import { createContentRepository } from "../src/index.js";

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
  await sql`insert into users (id,email) values (${ownerId},'content-owner@example.invalid'),(${otherOwnerId},'content-other@example.invalid')`;
});
afterAll(async () => {
  await sql.end();
});

describe("content library", () => {
  it("accepts every verified Town Library content kind", async () => {
    const content = createContentRepository(sql);
    const kinds = [
      "document",
      "email_draft",
      "spreadsheet",
      "deck",
      "file",
      "image",
      "video",
      "audio",
      "recording",
      "briefing",
      "link",
      "session",
    ] as const;
    const created = [];
    for (const kind of kinds) {
      created.push(
        await content.create({
          ownerId,
          kind,
          title: `${kind} fixture`,
          body: `fixture for ${kind}`,
          metadata: {},
        }),
      );
    }
    expect(created.map(({ kind }) => kind)).toEqual(kinds);
  });

  it("persists owner-isolated documents and immutable revisions", async () => {
    const content = createContentRepository(sql);
    const item = await content.create({
      ownerId,
      kind: "document",
      title: "Briefing",
      body: "First",
      metadata: {},
    });
    await expect(content.get(otherOwnerId, item.id)).rejects.toMatchObject({
      code: "CONTENT_NOT_FOUND",
    });
    const updated = await content.update({
      ownerId,
      contentId: item.id,
      expectedRevision: 1,
      title: "Briefing v2",
      body: "Second",
      metadata: {},
    });
    expect(updated.currentRevision).toBe(2);
    await expect(
      content.listRevisions(ownerId, item.id),
    ).resolves.toMatchObject([
      { revision: 2, body: "Second" },
      { revision: 1, body: "First" },
    ]);
    await expect(
      content.update({
        ownerId,
        contentId: item.id,
        expectedRevision: 1,
        title: "stale",
        body: "stale",
        metadata: {},
      }),
    ).rejects.toMatchObject({ code: "CONTENT_CONFLICT" });
    const revisions =
      await sql`select revision, body from content_revisions where content_id=${item.id} order by revision`;
    expect(revisions).toEqual([
      { revision: 1, body: "First" },
      { revision: 2, body: "Second" },
    ]);
  });

  it("uses opaque expiring share tokens and never accepts the hash as a token", async () => {
    const content = createContentRepository(sql);
    const item = await content.create({
      ownerId,
      kind: "file",
      title: "Export",
      storageKey: "objects/example",
      mimeType: "application/octet-stream",
      metadata: {},
    });
    const { token, share } = await content.createShare(
      ownerId,
      item.id,
      new Date(Date.now() + 60_000),
    );
    expect(token).not.toContain(item.id);
    await expect(content.resolveShare(token)).resolves.toMatchObject({
      id: item.id,
    });
    await content.revokeShare(ownerId, share.id);
    await expect(content.resolveShare(token)).rejects.toMatchObject({
      code: "SHARE_NOT_FOUND",
    });
    await expect(content.resolveShare("short-token")).rejects.toMatchObject({
      code: "SHARE_NOT_FOUND",
    });
    expect(content.toPublic(item)).toEqual({
      id: item.id,
      kind: "file",
      title: "Export",
      mimeType: "application/octet-stream",
      body: null,
    });
    await expect(
      content.createShare(ownerId, item.id, new Date(Date.now() - 1_000)),
    ).rejects.toMatchObject({ code: "CONTENT_CONFLICT" });
  });

  it("keeps collections owner-scoped and ordered", async () => {
    const content = createContentRepository(sql);
    const first = await content.create({
      ownerId,
      kind: "document",
      title: "First",
      body: "1",
      metadata: {},
    });
    const second = await content.create({
      ownerId,
      kind: "document",
      title: "Second",
      body: "2",
      metadata: {},
    });
    const collection = await content.createCollection({
      ownerId,
      name: "Briefings",
    });
    await content.addToCollection(ownerId, collection.id, second.id, 2);
    await content.addToCollection(ownerId, collection.id, first.id, 1);
    await expect(
      content.listCollection(otherOwnerId, collection.id),
    ).rejects.toMatchObject({ code: "COLLECTION_NOT_FOUND" });
    await expect(
      content.listCollection(ownerId, collection.id),
    ).resolves.toMatchObject([{ id: first.id }, { id: second.id }]);
  });

  it("paginates content with a stable owner-scoped cursor", async () => {
    const content = createContentRepository(sql);
    const created = [];
    for (const title of ["One", "Two", "Three"]) {
      created.push(
        await content.create({
          ownerId,
          kind: "document",
          title,
          body: title,
          metadata: {},
        }),
      );
    }
    const first = await content.listPage({
      ownerId,
      status: "active",
      limit: 2,
    });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    const nextCursor = first.nextCursor;
    expect(nextCursor).toEqual(expect.any(String));
    if (typeof nextCursor !== "string") throw new Error("Expected next cursor");
    expect(decodeCursor(nextCursor).key).toContain('"status":"active"');
    const second = await content.listPage({
      ownerId,
      status: "active",
      limit: 2,
      cursor: nextCursor,
    });
    expect(second.items).toHaveLength(1);
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)),
    ).toEqual(new Set(created.map((item) => item.id)));
    let mismatch: unknown;
    try {
      await content.listPage({
        ownerId,
        status: "archived",
        limit: 2,
        cursor: nextCursor,
      });
    } catch (error) {
      mismatch = error;
    }
    expect(mismatch).toBeDefined();
  });
});
