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

import { createAgentRepository } from "../src/agent-repository.js";
import { createThreadRepository } from "../src/thread-repository.js";

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
      (${ownerId}, 'thread-owner@example.invalid', 'UTC'),
      (${otherOwnerId}, 'thread-other@example.invalid', 'UTC')
  `;
});

afterAll(async () => {
  await sql.end();
});

async function createPersonal(owner: Id<"user">) {
  return createAgentRepository(sql).createPersonal({
    ownerId: owner,
    displayName: "Thread Test Assistant",
    instructions: "Use only synthetic thread fixtures.",
    defaultApprovalMode: "respect_tool_setting",
  });
}

describe("Thread repository", () => {
  it("updates conversation metadata and derives unread only from read state", async () => {
    const agent = await createPersonal(ownerId);
    const threads = createThreadRepository(sql);
    const thread = await threads.createAssistant({
      ownerId,
      agentId: agent.id,
      title: "Synthetic follow-up",
      approvalMode: "require_approval",
    });
    const updated = await threads.update({
      ownerId,
      threadId: thread.id,
      expectedRevision: 1,
      title: "Renamed follow-up",
      status: "archived",
      pinned: true,
      approvalMode: "autonomous",
      forceUnread: true,
    });

    expect(updated).toMatchObject({
      id: thread.id,
      title: "Renamed follow-up",
      status: "archived",
      approvalMode: "autonomous",
      revision: 2,
      unread: true,
    });
    expect(updated.pinnedAt).toBeInstanceOf(Date);

    await threads.appendSequence({ ownerId, threadId: thread.id });
    await threads.appendSequence({ ownerId, threadId: thread.id });
    const read = await threads.markRead({
      ownerId,
      threadId: thread.id,
      throughSequence: 2,
    });
    expect(read).toMatchObject({
      lastTurnSequence: 2,
      readThroughSequence: 2,
      unread: false,
    });

    const monotonic = await threads.markRead({
      ownerId,
      threadId: thread.id,
      throughSequence: 1,
    });
    expect(monotonic).toMatchObject({
      readThroughSequence: 2,
      unread: false,
    });
  });

  it("enforces Agent ownership, revisions, owner isolation, and deleted 404s", async () => {
    const agent = await createPersonal(ownerId);
    const otherAgent = await createPersonal(otherOwnerId);
    const threads = createThreadRepository(sql);

    await expect(
      threads.createAssistant({
        ownerId,
        agentId: otherAgent.id,
        title: "Cross-owner Agent",
        approvalMode: "respect_tool_setting",
      }),
    ).rejects.toMatchObject({ code: "THREAD_NOT_FOUND" });

    const thread = await threads.createAssistant({
      ownerId,
      agentId: agent.id,
      title: "Owner-only conversation",
      approvalMode: "respect_tool_setting",
    });
    await expect(
      threads.update({
        ownerId: otherOwnerId,
        threadId: thread.id,
        expectedRevision: 1,
        title: "Must not leak",
        status: "active",
        pinned: false,
        approvalMode: "respect_tool_setting",
        forceUnread: false,
      }),
    ).rejects.toMatchObject({ code: "THREAD_NOT_FOUND" });

    await threads.update({
      ownerId,
      threadId: thread.id,
      expectedRevision: 1,
      title: "Current title",
      status: "active",
      pinned: false,
      approvalMode: "require_approval",
      forceUnread: false,
    });
    await expect(
      threads.update({
        ownerId,
        threadId: thread.id,
        expectedRevision: 1,
        title: "Stale title",
        status: "active",
        pinned: false,
        approvalMode: "autonomous",
        forceUnread: false,
      }),
    ).rejects.toMatchObject({ code: "THREAD_REVISION_CONFLICT" });

    await threads.removeAssistant({
      ownerId,
      threadId: thread.id,
      expectedRevision: 2,
    });
    await expect(threads.get(ownerId, thread.id)).rejects.toMatchObject({
      code: "THREAD_NOT_FOUND",
    });
    await expect(
      threads.markRead({ ownerId, threadId: thread.id }),
    ).rejects.toMatchObject({ code: "THREAD_NOT_FOUND" });
  });

  it("requires task lifecycle ownership to delete task threads", async () => {
    const agent = await createPersonal(ownerId);
    const threads = createThreadRepository(sql);
    const taskThread = await threads.createTask({
      ownerId,
      agentId: agent.id,
      title: "Synthetic task",
      approvalMode: "respect_tool_setting",
    });

    await expect(
      threads.removeAssistant({
        ownerId,
        threadId: taskThread.id,
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({
      code: "TASK_THREAD_REQUIRES_TASK_DELETE",
    });
  });

  it("lists with stable pin/activity/ID order and filter-bound cursors", async () => {
    const agent = await createPersonal(ownerId);
    const threads = createThreadRepository(sql);
    const first = await threads.createAssistant({
      ownerId,
      agentId: agent.id,
      title: "Pinned latest",
      approvalMode: "respect_tool_setting",
    });
    const second = await threads.createAssistant({
      ownerId,
      agentId: agent.id,
      title: "Unpinned A",
      approvalMode: "respect_tool_setting",
    });
    const third = await threads.createAssistant({
      ownerId,
      agentId: agent.id,
      title: "Pinned older",
      approvalMode: "respect_tool_setting",
    });
    const fourth = await threads.createAssistant({
      ownerId,
      agentId: agent.id,
      title: "Unpinned B",
      approvalMode: "respect_tool_setting",
    });
    await sql`
      update threads set
        pinned_at = case
          when id = ${first.id} then '2026-08-02T04:00:00Z'::timestamptz
          when id = ${third.id} then '2026-08-02T03:00:00Z'::timestamptz
          else null
        end,
        updated_at = case
          when id in (${second.id}, ${fourth.id})
            then '2026-08-02T05:00:00Z'::timestamptz
          else '2026-08-02T02:00:00Z'::timestamptz
        end
      where owner_id = ${ownerId}
    `;

    const orderedIds = [first.id, third.id, ...[second.id, fourth.id].sort()];
    const page1 = await threads.list({ ownerId, limit: 2 });
    expect(page1.items.map(({ id }) => id)).toEqual(orderedIds.slice(0, 2));
    expect(page1.nextCursor).toBeTypeOf("string");
    if (page1.nextCursor === null) throw new Error("Expected a cursor.");
    const page2 = await threads.list({
      ownerId,
      limit: 2,
      cursor: page1.nextCursor,
    });
    expect(page2.items.map(({ id }) => id)).toEqual(orderedIds.slice(2));
    expect(
      new Set([...page1.items, ...page2.items].map(({ id }) => id)).size,
    ).toBe(4);
    await expect(
      threads.list({ ownerId, pinned: true, limit: 10 }),
    ).resolves.toMatchObject({
      items: [{ id: first.id }, { id: third.id }],
      nextCursor: null,
    });

    await expect(
      threads.list({
        ownerId,
        kinds: ["task"],
        limit: 2,
        cursor: page1.nextCursor,
      }),
    ).rejects.toThrow();
    await expect(
      threads.list({ ownerId, limit: 2, unknownFilter: true } as never),
    ).rejects.toThrow();
  });
});
