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
      (${ownerId}, 'agent-owner@example.invalid', 'UTC'),
      (${otherOwnerId}, 'agent-other@example.invalid', 'UTC')
  `;
});

afterAll(async () => {
  await sql.end();
});

describe("personal Agent repository", () => {
  it("creates one personal Agent and publishes immutable versions atomically", async () => {
    const agents = createAgentRepository(sql);
    const version1 = await agents.createPersonal({
      ownerId,
      displayName: "Test Assistant",
      instructions: "Prefer concise synthetic test output.",
      defaultApprovalMode: "respect_tool_setting",
    });
    const version2 = await agents.publishPersonal({
      ownerId,
      expectedRevision: 1,
      displayName: "Test Assistant",
      instructions: "Ask before synthetic write actions.",
      defaultApprovalMode: "require_approval",
      changeReason: "Owner changed safety preference",
    });

    expect(version1).toMatchObject({
      ownerId,
      kind: "personal",
      revision: 1,
      activeVersion: {
        version: 1,
        snapshot: {
          instructions: "Prefer concise synthetic test output.",
        },
      },
    });
    expect(version2).toMatchObject({
      id: version1.id,
      revision: 2,
      activeVersion: {
        version: 2,
        changeReason: "Owner changed safety preference",
        snapshot: {
          instructions: "Ask before synthetic write actions.",
          defaultApprovalMode: "require_approval",
        },
      },
    });

    const history = await agents.listVersions({
      ownerId,
      agentId: version1.id,
      limit: 10,
    });
    expect(history.items.map(({ version }) => version)).toEqual([2, 1]);
    expect(history.items[1]?.snapshot.instructions).toBe(
      "Prefer concise synthetic test output.",
    );
    await expect(sql`
      update agent_versions
      set snapshot = ${sql.json({
        displayName: "Mutated",
        instructions: "Historical versions must not change.",
        defaultApprovalMode: "autonomous",
      })}
      where id = ${version1.activeVersion.id}
    `).rejects.toMatchObject({ code: "55000" });
    await expect(sql`
      delete from agent_versions where id = ${version1.activeVersion.id}
    `).rejects.toMatchObject({ code: "55000" });
    await expect(sql`
      delete from agents where id = ${version1.id}
    `).rejects.toMatchObject({ code: "55000" });
    await expect(sql`
      delete from users where id = ${ownerId}
    `).resolves.toBeDefined();
  });

  it("rejects duplicate creation, stale publication, and cross-owner lookup", async () => {
    const agents = createAgentRepository(sql);
    const created = await agents.createPersonal({
      ownerId,
      displayName: "Owner Assistant",
      instructions: "Use only test fixtures.",
      defaultApprovalMode: "respect_tool_setting",
    });

    await expect(
      agents.createPersonal({
        ownerId,
        displayName: "Duplicate",
        instructions: "Must not be created.",
        defaultApprovalMode: "require_approval",
      }),
    ).rejects.toMatchObject({ code: "PERSONAL_AGENT_ALREADY_EXISTS" });
    await agents.publishPersonal({
      ownerId,
      expectedRevision: 1,
      displayName: "Owner Assistant",
      instructions: "Second version.",
      defaultApprovalMode: "respect_tool_setting",
    });
    await expect(
      agents.publishPersonal({
        ownerId,
        expectedRevision: 1,
        displayName: "Owner Assistant",
        instructions: "Stale write.",
        defaultApprovalMode: "autonomous",
      }),
    ).rejects.toMatchObject({ code: "AGENT_REVISION_CONFLICT" });
    await expect(agents.getPersonal(otherOwnerId)).rejects.toMatchObject({
      code: "AGENT_NOT_FOUND",
    });
    await expect(
      agents.listVersions({
        ownerId: otherOwnerId,
        agentId: created.id,
        limit: 10,
      }),
    ).rejects.toMatchObject({ code: "AGENT_NOT_FOUND" });
  });

  it("paginates version history deterministically with owner-bound cursors", async () => {
    const agents = createAgentRepository(sql);
    const created = await agents.createPersonal({
      ownerId,
      displayName: "Paged Assistant",
      instructions: "Version one.",
      defaultApprovalMode: "respect_tool_setting",
    });
    await agents.publishPersonal({
      ownerId,
      expectedRevision: 1,
      displayName: "Paged Assistant",
      instructions: "Version two.",
      defaultApprovalMode: "respect_tool_setting",
    });
    await agents.publishPersonal({
      ownerId,
      expectedRevision: 2,
      displayName: "Paged Assistant",
      instructions: "Version three.",
      defaultApprovalMode: "require_approval",
    });

    const first = await agents.listVersions({
      ownerId,
      agentId: created.id,
      limit: 2,
    });
    expect(first.items.map(({ version }) => version)).toEqual([3, 2]);
    expect(first.nextCursor).toBeTypeOf("string");
    if (first.nextCursor === null) throw new Error("Expected a cursor.");

    const second = await agents.listVersions({
      ownerId,
      agentId: created.id,
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.items.map(({ version }) => version)).toEqual([1]);
    expect(second.nextCursor).toBeNull();

    await expect(
      agents.listVersions({
        ownerId: otherOwnerId,
        agentId: created.id,
        limit: 2,
        cursor: first.nextCursor,
      }),
    ).rejects.toMatchObject({ code: "AGENT_NOT_FOUND" });
  });
});

describe("routine Agent repository", () => {
  it("creates and lists owner-scoped routine Agents", async () => {
    const agents = createAgentRepository(sql);
    const routine = await agents.createRoutine({
      ownerId,
      displayName: "Morning routine",
      instructions: "Summarize the owner's morning signals.",
      defaultApprovalMode: "require_approval",
    });

    expect(routine).toMatchObject({
      ownerId,
      kind: "routine",
      activeVersion: { version: 1 },
    });
    expect((await agents.listRoutines(ownerId)).map(({ id }) => id)).toEqual([
      routine.id,
    ]);
    const published = await agents.publishRoutine({
      ownerId,
      agentId: routine.id,
      expectedRevision: 1,
      displayName: "Morning routine v2",
      instructions: "Ask for approval before external actions.",
      defaultApprovalMode: "require_approval",
      changeReason: "Tighten routine safety",
    });
    expect(published).toMatchObject({
      id: routine.id,
      revision: 2,
      activeVersion: {
        version: 2,
        snapshot: { displayName: "Morning routine v2" },
      },
    });
    const history = await agents.listVersions({
      ownerId,
      agentId: routine.id,
      kind: "routine",
      limit: 10,
    });
    expect(history.items.map(({ version }) => version)).toEqual([2, 1]);
    await expect(
      agents.publishRoutine({
        ownerId,
        agentId: routine.id,
        expectedRevision: 1,
        displayName: "Stale",
        instructions: "Must reject stale writes.",
        defaultApprovalMode: "autonomous",
      }),
    ).rejects.toMatchObject({ code: "AGENT_REVISION_CONFLICT" });
    expect(await agents.listRoutines(otherOwnerId)).toEqual([]);
  });
});
