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
});
