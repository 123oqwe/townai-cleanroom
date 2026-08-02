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

import { createAgentRepository } from "@town/agents";
import { newId, type Id } from "@town/contracts";
import { runMigrations } from "@town/db";

import {
  createToolRegistryRepository,
  ToolRegistryError,
} from "../src/index.js";

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
      (${ownerId}, 'tools-owner@example.invalid', 'UTC'),
      (${otherOwnerId}, 'tools-other@example.invalid', 'UTC')
  `;
});

afterAll(async () => {
  await sql.end();
});

describe("tool registry", () => {
  it("creates owner-scoped immutable definitions and explicit AgentVersion bindings", async () => {
    const agents = createAgentRepository(sql);
    const agent = await agents.createPersonal({
      ownerId,
      displayName: "Tool Registry Fixture",
      instructions: "Use only explicit tool metadata.",
      defaultApprovalMode: "require_approval",
    });
    const registry = createToolRegistryRepository(sql);
    const tool = await registry.create({
      ownerId,
      name: "private_label",
      description: "Apply a private label.",
      inputSchema: {
        type: "object",
        properties: { label: { type: "string" } },
      },
      outputSchema: null,
      sideEffect: "private_write",
      dataSensitivity: "private",
      accountBinding: "required",
    });
    const binding = await registry.bind({
      ownerId,
      agentVersionId: agent.activeVersion.id,
      toolDefinitionId: tool.id,
      modeOverride: "approval_required",
      accountScope: ["primary-account"],
    });
    expect(binding).toMatchObject({
      ownerId,
      agentVersionId: agent.activeVersion.id,
      toolDefinitionId: tool.id,
      modeOverride: "approval_required",
      accountScope: ["primary-account"],
    });
    await expect(registry.get(otherOwnerId, tool.id)).rejects.toMatchObject({
      code: "TOOL_NOT_FOUND",
    });
    await expect(
      registry.listForAgentVersion({
        ownerId,
        agentVersionId: agent.activeVersion.id,
      }),
    ).resolves.toMatchObject([{ id: tool.id, binding: { id: binding.id } }]);
    await expect(
      sql`update tool_definitions set description = 'spoofed' where id = ${tool.id}`,
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      sql`delete from users where id = ${ownerId}`,
    ).resolves.toBeDefined();
    const [remaining] = await sql<{ count: number }[]>`
      select count(*)::int as count from tool_definitions where owner_id = ${ownerId}
    `;
    expect(remaining?.count).toBe(0);
  });

  it("rejects duplicate names and duplicate bindings without weakening ownership", async () => {
    const agent = await createAgentRepository(sql).createPersonal({
      ownerId,
      displayName: "Duplicate Fixture",
      instructions: "Use only explicit tool metadata.",
      defaultApprovalMode: "require_approval",
    });
    const registry = createToolRegistryRepository(sql);
    const input = {
      ownerId,
      name: "search_public",
      description: "Search public sources.",
      inputSchema: { type: "object" },
      outputSchema: null,
      sideEffect: "read" as const,
      dataSensitivity: "public" as const,
      accountBinding: "none" as const,
    };
    const tool = await registry.create(input);
    await expect(registry.create(input)).rejects.toBeInstanceOf(
      ToolRegistryError,
    );
    await registry.bind({
      ownerId,
      agentVersionId: agent.activeVersion.id,
      toolDefinitionId: tool.id,
    });
    await expect(
      registry.bind({
        ownerId,
        agentVersionId: agent.activeVersion.id,
        toolDefinitionId: tool.id,
      }),
    ).rejects.toMatchObject({ code: "TOOL_BINDING_CONFLICT" });
  });
});
