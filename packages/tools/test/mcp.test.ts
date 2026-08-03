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
import { runMigrations } from "@town/db";
import { newId, type Id } from "@town/contracts";
import { createAgentRepository } from "@town/agents";
import { createMcpRepository } from "../src/index.js";

let sql: Sql;
let ownerId: Id<"user">;

beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 4 });
  await runMigrations(sql);
});

beforeEach(async () => {
  await sql`truncate table users cascade`;
  ownerId = newId<"user">();
  await sql`insert into users (id,email,timezone) values (${ownerId},'mcp-owner@example.invalid','UTC')`;
});

afterAll(async () => sql.end());

describe("MCP server metadata", () => {
  it("creates, lists, disables, and enforces revision checks", async () => {
    const repository = createMcpRepository(sql);
    const server = await repository.create({
      ownerId,
      name: "Local MCP",
      url: "https://mcp.example.invalid/sse",
      transport: "sse",
      authRef: "secret://mcp/local",
    });
    await expect(repository.list(ownerId)).resolves.toMatchObject([
      { id: server.id, name: "Local MCP", status: "active", revision: 1 },
    ]);
    await expect(
      repository.create({
        ownerId,
        name: "Local MCP",
        url: "https://other.example.invalid",
      }),
    ).rejects.toThrow("MCP_SERVER_ALREADY_EXISTS");
    const disabled = await repository.disable(ownerId, server.id, 1);
    expect(disabled).toMatchObject({ status: "disabled", revision: 2 });
    await expect(repository.disable(ownerId, server.id, 1)).rejects.toThrow(
      "MCP_SERVER_CONFLICT",
    );
  });

  it("binds an MCP server only to an explicit immutable AgentVersion", async () => {
    const agent = await createAgentRepository(sql).createPersonal({
      ownerId,
      displayName: "MCP Routine Fixture",
      instructions: "Use only explicitly enabled servers.",
      defaultApprovalMode: "require_approval",
    });
    const repository = createMcpRepository(sql);
    const server = await repository.create({
      ownerId,
      name: "Routine MCP",
      url: "https://mcp.example.invalid/tools",
    });
    const binding = await repository.bind({
      ownerId,
      agentVersionId: agent.activeVersion.id,
      mcpServerId: server.id,
      modeOverride: "approval_required",
      accountScope: ["primary-account"],
    });
    await expect(
      repository.listForAgentVersion({
        ownerId,
        agentVersionId: agent.activeVersion.id,
      }),
    ).resolves.toMatchObject([
      {
        id: server.id,
        binding: {
          id: binding.id,
          modeOverride: "approval_required",
          accountScope: ["primary-account"],
        },
      },
    ]);
    await expect(
      repository.bind({
        ownerId,
        agentVersionId: agent.activeVersion.id,
        mcpServerId: server.id,
      }),
    ).rejects.toThrow("MCP_BINDING_ALREADY_EXISTS");
    await expect(
      repository.disableBinding(ownerId, binding.id, 1),
    ).resolves.toMatchObject({ enabled: false, revision: 2 });
    await expect(
      repository.disableBinding(ownerId, binding.id, 1),
    ).rejects.toThrow("MCP_SERVER_CONFLICT");
  });
});
