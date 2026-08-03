import type { Sql } from "postgres";
import { z } from "zod";
import { asId, idSchema, newId, type Id } from "@town/contracts";

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
  return { list, create, disable };
}
export type McpRepository = ReturnType<typeof createMcpRepository>;
