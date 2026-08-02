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
import { createTurnRepository } from "../src/turn-repository.js";

let sql: Sql;
let ownerId: Id<"user">;
let otherOwnerId: Id<"user">;

beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 6 });
  await runMigrations(sql);
});

beforeEach(async () => {
  await sql`truncate table users cascade`;
  ownerId = newId<"user">();
  otherOwnerId = newId<"user">();
  await sql`
    insert into users (id, email, timezone)
    values
      (${ownerId}, 'turn-owner@example.invalid', 'UTC'),
      (${otherOwnerId}, 'turn-other@example.invalid', 'UTC')
  `;
});

afterAll(async () => {
  await sql.end();
});

async function fixture(owner: Id<"user">) {
  const agent = await createAgentRepository(sql).createPersonal({
    ownerId: owner,
    displayName: "Turn Test Assistant",
    instructions: "Use only synthetic turn fixtures.",
    defaultApprovalMode: "respect_tool_setting",
  });
  const thread = await createThreadRepository(sql).createAssistant({
    ownerId: owner,
    agentId: agent.id,
    title: "Synthetic conversation",
    approvalMode: "respect_tool_setting",
  });
  return { agent, thread };
}

describe("Turn repository", () => {
  it("separates public user append from internal runtime append", async () => {
    const { agent, thread } = await fixture(ownerId);
    const turns = createTurnRepository(sql);
    const user = await turns.appendUser({
      ownerId,
      threadId: thread.id,
      text: "Review the synthetic project update.",
      mentions: [
        {
          position: 0,
          targetType: "agent",
          targetId: agent.id,
          label: "Test Assistant",
        },
      ],
    });
    const runtime = await turns.appendRuntime({
      ownerId,
      threadId: thread.id,
      role: "assistant",
      text: "Synthetic runtime response.",
      sourceRef: "test-session-reference",
      mentions: [],
    });

    expect(user).toMatchObject({
      sequence: 1,
      role: "user",
      sourceType: "user",
      sourceRef: null,
      mentions: [{ targetType: "agent", targetId: agent.id }],
    });
    expect(runtime).toMatchObject({
      sequence: 2,
      role: "assistant",
      sourceType: "runtime",
      sourceRef: "test-session-reference",
    });
    const mention = user.mentions[0];
    if (mention === undefined) throw new Error("Expected a persisted Mention.");
    await expect(sql`
      delete from thread_mentions where id = ${mention.id}
    `).rejects.toMatchObject({ code: "55000" });
    expect(() =>
      turns.appendUser({
        ownerId,
        threadId: thread.id,
        text: "Attempt to forge runtime provenance.",
        mentions: [],
        role: "assistant",
        sourceRef: "forged",
      } as never),
    ).toThrow();
  });

  it("allocates exact gapless sequences under concurrent committed appends", async () => {
    const { thread } = await fixture(ownerId);
    const turns = createTurnRepository(sql);
    const appended = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        turns.appendUser({
          ownerId,
          threadId: thread.id,
          text: `Concurrent synthetic turn ${index + 1}`,
          mentions: [],
        }),
      ),
    );

    expect(
      appended.map(({ sequence }) => sequence).sort((a, b) => a - b),
    ).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    await expect(
      createThreadRepository(sql).get(ownerId, thread.id),
    ).resolves.toMatchObject({ lastTurnSequence: 20, unread: true });
  });

  it("rejects unavailable and cross-owner mentions without consuming a sequence", async () => {
    const { thread } = await fixture(ownerId);
    const { agent: otherAgent } = await fixture(otherOwnerId);
    const turns = createTurnRepository(sql);

    await expect(
      turns.appendUser({
        ownerId,
        threadId: thread.id,
        text: "Cross-owner mention.",
        mentions: [
          {
            position: 0,
            targetType: "agent",
            targetId: otherAgent.id,
            label: "Other owner",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "AGENT_NOT_FOUND" });
    await expect(
      turns.appendUser({
        ownerId,
        threadId: thread.id,
        text: "Unavailable routine mention.",
        mentions: [
          {
            position: 0,
            targetType: "routine",
            targetId: newId<"routine">(),
            label: "Not installed",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "REFERENCE_UNAVAILABLE" });
    expect(() =>
      turns.appendUser({
        ownerId,
        threadId: thread.id,
        text: "Duplicate positions.",
        mentions: [
          {
            position: 0,
            targetType: "thread",
            targetId: thread.id,
            label: "First",
          },
          {
            position: 0,
            targetType: "thread",
            targetId: thread.id,
            label: "Second",
          },
        ],
      }),
    ).toThrow();

    const committed = await turns.appendUser({
      ownerId,
      threadId: thread.id,
      text: "First valid turn.",
      mentions: [],
    });
    expect(committed.sequence).toBe(1);
  });

  it("preserves prior turns, paginates deterministically, and rejects deleted Threads", async () => {
    const { thread } = await fixture(ownerId);
    const turns = createTurnRepository(sql);
    const first = await turns.appendUser({
      ownerId,
      threadId: thread.id,
      text: "Immutable first turn.",
      mentions: [],
    });
    await turns.appendRuntime({
      ownerId,
      threadId: thread.id,
      role: "system",
      text: "Synthetic system note.",
      sourceRef: "test-runtime-event",
      mentions: [],
    });
    await turns.appendUser({
      ownerId,
      threadId: thread.id,
      text: "Third turn.",
      mentions: [],
    });

    const page1 = await turns.list({ ownerId, threadId: thread.id, limit: 2 });
    expect(page1.items.map(({ sequence }) => sequence)).toEqual([1, 2]);
    expect(page1.items[0]).toEqual(first);
    if (page1.nextCursor === null) throw new Error("Expected a cursor.");
    const page2 = await turns.list({
      ownerId,
      threadId: thread.id,
      limit: 2,
      cursor: page1.nextCursor,
    });
    expect(page2.items.map(({ sequence }) => sequence)).toEqual([3]);
    expect(page2.nextCursor).toBeNull();
    await expect(sql`
      update thread_turns set text = 'Mutated history' where id = ${first.id}
    `).rejects.toMatchObject({ code: "55000" });
    await expect(sql`
      delete from thread_turns where id = ${first.id}
    `).rejects.toMatchObject({ code: "55000" });
    await expect(sql`
      delete from threads where id = ${thread.id}
    `).rejects.toMatchObject({ code: "55000" });

    await createThreadRepository(sql).removeAssistant({
      ownerId,
      threadId: thread.id,
      expectedRevision: 1,
    });
    await expect(
      turns.appendUser({
        ownerId,
        threadId: thread.id,
        text: "Must not append after deletion.",
        mentions: [],
      }),
    ).rejects.toMatchObject({ code: "THREAD_NOT_FOUND" });
    await expect(
      turns.list({ ownerId, threadId: thread.id, limit: 10 }),
    ).rejects.toMatchObject({ code: "THREAD_NOT_FOUND" });
  });
});
