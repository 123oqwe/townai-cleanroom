import type { Sql } from "postgres";
import { z } from "zod";
import { asId, idSchema, newId, type Id } from "@town/contracts";
import { executionModeSchema, type ExecutionMode } from "./types.js";

export const mcpTransportSchema = z.enum(["streamable_http", "sse"]);
export const mcpStatusSchema = z.enum(["active", "disabled"]);
export class McpRepositoryError extends Error {
  constructor(
    readonly code: "MCP_SERVER_ALREADY_EXISTS" | "MCP_SERVER_CONFLICT",
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "McpRepositoryError";
  }
}
export interface McpServer {
  id: Id<"mcp-server">;
  ownerId: Id<"user">;
  name: string;
  url: string;
  transport: z.infer<typeof mcpTransportSchema>;
  authRef: string | null;
  status: z.infer<typeof mcpStatusSchema>;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface McpServerBinding {
  id: Id<"mcp-server-binding">;
  ownerId: Id<"user">;
  agentVersionId: Id<"agent-version">;
  mcpServerId: Id<"mcp-server">;
  modeOverride: ExecutionMode | null;
  accountScope: string[];
  enabled: boolean;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}
type Row = {
  id: string;
  owner_id: string;
  name: string;
  url: string;
  transport: "streamable_http" | "sse";
  auth_ref: string | null;
  status: "active" | "disabled";
  revision: number;
  created_at: Date;
  updated_at: Date;
};
type BindingRow = {
  id: string;
  owner_id: string;
  agent_version_id: string;
  mcp_server_id: string;
  mode_override: ExecutionMode | null;
  account_scope: string[];
  enabled: boolean;
  revision: number;
  created_at: Date;
  updated_at: Date;
};
type JoinedBindingRow = Row & {
  binding_id: string;
  binding_owner_id: string;
  binding_agent_version_id: string;
  binding_mcp_server_id: string;
  binding_mode_override: ExecutionMode | null;
  binding_account_scope: string[];
  binding_enabled: boolean;
  binding_revision: number;
  binding_created_at: Date;
  binding_updated_at: Date;
};
function safe(row: Row): McpServer {
  return {
    id: asId<"mcp-server">(row.id),
    ownerId: asId<"user">(row.owner_id),
    name: row.name,
    url: row.url,
    transport: mcpTransportSchema.parse(row.transport),
    authRef: row.auth_ref,
    status: mcpStatusSchema.parse(row.status),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function safeBinding(row: BindingRow): McpServerBinding {
  return {
    id: asId<"mcp-server-binding">(row.id),
    ownerId: asId<"user">(row.owner_id),
    agentVersionId: asId<"agent-version">(row.agent_version_id),
    mcpServerId: asId<"mcp-server">(row.mcp_server_id),
    modeOverride: row.mode_override
      ? executionModeSchema.parse(row.mode_override)
      : null,
    accountScope: row.account_scope,
    enabled: row.enabled,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export function createMcpRepository(sql: Sql) {
  const input = z
    .object({
      ownerId: idSchema,
      name: z.string().trim().min(1).max(120),
      url: z
        .url()
        .refine((v) => v.startsWith("http://") || v.startsWith("https://")),
      transport: mcpTransportSchema.default("streamable_http"),
      authRef: z.string().trim().min(1).max(500).nullable().optional(),
    })
    .strict();
  const bindingInput = z
    .object({
      ownerId: idSchema,
      agentVersionId: idSchema,
      mcpServerId: idSchema,
      modeOverride: executionModeSchema.nullable().optional(),
      accountScope: z.array(z.string().trim().min(1)).max(100).default([]),
    })
    .strict();
  async function list(ownerId: Id<"user">): Promise<McpServer[]> {
    const rows = await sql<
      Row[]
    >`select * from mcp_servers where owner_id=${ownerId} order by created_at,id`;
    return rows.map(safe);
  }
  async function create(value: z.input<typeof input>): Promise<McpServer> {
    const v = input.parse(value);
    const id = newId<"mcp-server">();
    try {
      const rows = await sql<
        Row[]
      >`insert into mcp_servers (id,owner_id,name,url,transport,auth_ref) values (${id},${v.ownerId},${v.name},${v.url},${v.transport},${v.authRef ?? null}) returning *`;
      const row = rows[0];
      if (!row) throw new Error("MCP_SERVER_INSERT_FAILED");
      return safe(row);
    } catch (error) {
      if (
        typeof error === "object" &&
        error &&
        "constraint_name" in error &&
        error.constraint_name === "mcp_servers_owner_name_unique"
      )
        throw new McpRepositoryError("MCP_SERVER_ALREADY_EXISTS", {
          cause: error,
        });
      throw error;
    }
  }
  async function disable(
    ownerId: Id<"user">,
    id: Id<"mcp-server">,
    expectedRevision: number,
  ): Promise<McpServer> {
    const rows = await sql<
      Row[]
    >`update mcp_servers set status='disabled',revision=revision+1,updated_at=now() where owner_id=${ownerId} and id=${id} and revision=${expectedRevision} returning *`;
    const row = rows[0];
    if (!row) throw new McpRepositoryError("MCP_SERVER_CONFLICT");
    return safe(row);
  }
  async function bind(
    value: z.input<typeof bindingInput>,
  ): Promise<McpServerBinding> {
    const v = bindingInput.parse(value);
    const id = newId<"mcp-server-binding">();
    try {
      const rows = await sql<BindingRow[]>`
        insert into mcp_server_bindings
          (id, owner_id, agent_version_id, mcp_server_id, mode_override, account_scope)
        values
          (${id}, ${v.ownerId}, ${v.agentVersionId}, ${v.mcpServerId},
           ${v.modeOverride ?? null}, ${sql.json(v.accountScope)})
        returning *
      `;
      const row = rows[0];
      if (!row) throw new Error("MCP_BINDING_INSERT_FAILED");
      return safeBinding(row);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "constraint_name" in error &&
        error.constraint_name === "mcp_bindings_owner_version_server_unique"
      ) {
        throw new McpRepositoryError("MCP_SERVER_ALREADY_EXISTS", {
          cause: error,
        });
      }
      throw error;
    }
  }
  async function listForAgentVersion(inputValue: {
    ownerId: Id<"user">;
    agentVersionId: Id<"agent-version">;
  }): Promise<Array<McpServer & { binding: McpServerBinding }>> {
    const value = z
      .object({ ownerId: idSchema, agentVersionId: idSchema })
      .parse(inputValue);
    const rows = await sql<JoinedBindingRow[]>`
      select server.*, binding.id as binding_id,
        binding.owner_id as binding_owner_id,
        binding.agent_version_id as binding_agent_version_id,
        binding.mcp_server_id as binding_mcp_server_id,
        binding.mode_override as binding_mode_override,
        binding.account_scope as binding_account_scope,
        binding.enabled as binding_enabled,
        binding.revision as binding_revision,
        binding.created_at as binding_created_at,
        binding.updated_at as binding_updated_at
      from mcp_server_bindings binding
      join mcp_servers server
        on server.owner_id=binding.owner_id and server.id=binding.mcp_server_id
      where binding.owner_id=${value.ownerId}
        and binding.agent_version_id=${value.agentVersionId}
        and binding.enabled=true and server.status='active'
      order by server.name, server.id
    `;
    return rows.map((row) => ({
      ...safe(row),
      binding: safeBinding({
        id: row.binding_id,
        owner_id: row.binding_owner_id,
        agent_version_id: row.binding_agent_version_id,
        mcp_server_id: row.binding_mcp_server_id,
        mode_override: row.binding_mode_override,
        account_scope: row.binding_account_scope,
        enabled: row.binding_enabled,
        revision: row.binding_revision,
        created_at: row.binding_created_at,
        updated_at: row.binding_updated_at,
      }),
    }));
  }
  async function disableBinding(
    ownerId: Id<"user">,
    id: Id<"mcp-server-binding">,
    expectedRevision: number,
  ): Promise<McpServerBinding> {
    const rows = await sql<BindingRow[]>`
      update mcp_server_bindings
      set enabled=false, revision=revision+1, updated_at=now()
      where owner_id=${ownerId} and id=${id} and revision=${expectedRevision}
      returning *
    `;
    const row = rows[0];
    if (!row) throw new McpRepositoryError("MCP_SERVER_CONFLICT");
    return safeBinding(row);
  }
  return { list, create, disable, bind, listForAgentVersion, disableBinding };
}
export type McpRepository = ReturnType<typeof createMcpRepository>;
