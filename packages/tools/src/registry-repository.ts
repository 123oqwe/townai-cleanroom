import type { Sql } from "postgres";
import { z } from "zod";

import { asId, idSchema, newId, type Id } from "@town/contracts";

import {
  executionModeSchema,
  toolDefinitionInputSchema,
  type AgentToolBinding,
  type ToolDefinition,
} from "./types.js";

interface ToolDefinitionRow {
  id: string;
  owner_id: string;
  name: string;
  version: number;
  description: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown> | null;
  side_effect: ToolDefinition["sideEffect"];
  data_sensitivity: ToolDefinition["dataSensitivity"];
  account_binding: ToolDefinition["accountBinding"];
  enabled: boolean;
  created_at: Date;
}

interface BindingRow {
  id: string;
  owner_id: string;
  agent_version_id: string;
  tool_definition_id: string;
  mode_override: AgentToolBinding["modeOverride"];
  account_scope: string[];
  created_at: Date;
}

interface JoinedToolBindingRow extends ToolDefinitionRow {
  binding_id: string;
  agent_version_id: string;
  tool_definition_id: string;
  mode_override: AgentToolBinding["modeOverride"];
  account_scope: string[];
  binding_created_at: Date;
}

export class ToolRegistryError extends Error {
  constructor(
    readonly code:
      | "TOOL_NOT_FOUND"
      | "TOOL_BINDING_NOT_FOUND"
      | "TOOL_NAME_CONFLICT"
      | "TOOL_BINDING_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "ToolRegistryError";
  }
}

function safeDefinition(row: ToolDefinitionRow): ToolDefinition {
  return {
    id: asId<"tool-definition">(row.id),
    ownerId: asId<"user">(row.owner_id),
    name: row.name,
    version: row.version,
    description: row.description,
    inputSchema: row.input_schema,
    outputSchema: row.output_schema,
    sideEffect: row.side_effect,
    dataSensitivity: row.data_sensitivity,
    accountBinding: row.account_binding,
    enabled: row.enabled,
    createdAt: row.created_at,
  };
}

function safeBinding(row: BindingRow): AgentToolBinding {
  return {
    id: asId<"agent-tool-binding">(row.id),
    ownerId: asId<"user">(row.owner_id),
    agentVersionId: asId<"agent-version">(row.agent_version_id),
    toolDefinitionId: asId<"tool-definition">(row.tool_definition_id),
    modeOverride: row.mode_override,
    accountScope: row.account_scope,
    createdAt: row.created_at,
  };
}

export function createToolRegistryRepository(sql: Sql) {
  async function get(
    ownerId: Id<"user">,
    toolId: Id<"tool-definition">,
  ): Promise<ToolDefinition> {
    const value = z
      .object({ ownerId: idSchema, toolId: idSchema })
      .parse({ ownerId, toolId });
    const [row] = await sql<ToolDefinitionRow[]>`
      select id, owner_id, name, version, description, input_schema,
        output_schema, side_effect, data_sensitivity, account_binding,
        enabled, created_at
      from tool_definitions
      where owner_id = ${value.ownerId} and id = ${value.toolId}
    `;
    if (row === undefined) {
      throw new ToolRegistryError("TOOL_NOT_FOUND", "The Tool was not found.");
    }
    return safeDefinition(row);
  }

  async function create(
    input: {
      ownerId: Id<"user">;
      version?: number;
    } & z.input<typeof toolDefinitionInputSchema>,
  ): Promise<ToolDefinition> {
    const value = toolDefinitionInputSchema
      .extend({
        ownerId: idSchema,
        version: z.number().int().positive().default(1),
      })
      .parse(input);
    const id = newId<"tool-definition">();
    try {
      await sql`
        insert into tool_definitions (
          id, owner_id, name, version, description, input_schema,
          output_schema, side_effect, data_sensitivity, account_binding
        ) values (
          ${id}, ${value.ownerId}, ${value.name}, ${value.version},
          ${value.description}, ${sql.json(value.inputSchema)},
          ${value.outputSchema === null ? null : sql.json(value.outputSchema)},
          ${value.sideEffect}, ${value.dataSensitivity}, ${value.accountBinding}
        )
      `;
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "constraint_name" in error &&
        error.constraint_name === "tool_definitions_owner_name_version_unique"
      ) {
        throw new ToolRegistryError(
          "TOOL_NAME_CONFLICT",
          "That Tool name and version already exists.",
        );
      }
      throw error;
    }
    return get(asId<"user">(value.ownerId), id);
  }

  async function bind(input: {
    ownerId: Id<"user">;
    agentVersionId: Id<"agent-version">;
    toolDefinitionId: Id<"tool-definition">;
    modeOverride?: AgentToolBinding["modeOverride"];
    accountScope?: string[];
  }): Promise<AgentToolBinding> {
    const value = z
      .object({
        ownerId: idSchema,
        agentVersionId: idSchema,
        toolDefinitionId: idSchema,
        modeOverride: executionModeSchema.nullable().optional(),
        accountScope: z.array(z.string().trim().min(1)).max(100).default([]),
      })
      .strict()
      .parse(input);
    const id = newId<"agent-tool-binding">();
    try {
      await sql`
        insert into agent_tool_bindings (
          id, owner_id, agent_version_id, tool_definition_id,
          mode_override, account_scope
        ) values (
          ${id}, ${value.ownerId}, ${value.agentVersionId},
          ${value.toolDefinitionId}, ${value.modeOverride ?? null},
          ${sql.json(value.accountScope)}
        )
      `;
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "constraint_name" in error &&
        error.constraint_name ===
          "agent_tool_bindings_owner_version_tool_unique"
      ) {
        throw new ToolRegistryError(
          "TOOL_BINDING_CONFLICT",
          "That Tool is already bound to this AgentVersion.",
        );
      }
      throw error;
    }
    const [row] = await sql<BindingRow[]>`
      select id, owner_id, agent_version_id, tool_definition_id,
        mode_override, account_scope, created_at
      from agent_tool_bindings
      where owner_id = ${value.ownerId} and id = ${id}
    `;
    if (row === undefined) {
      throw new ToolRegistryError(
        "TOOL_BINDING_NOT_FOUND",
        "The Tool binding was not created.",
      );
    }
    return safeBinding(row);
  }

  async function listForAgentVersion(input: {
    ownerId: Id<"user">;
    agentVersionId: Id<"agent-version">;
  }): Promise<Array<ToolDefinition & { binding: AgentToolBinding }>> {
    const value = z
      .object({ ownerId: idSchema, agentVersionId: idSchema })
      .parse(input);
    const rows = await sql<JoinedToolBindingRow[]>`
      select
        tool.id, tool.owner_id, tool.name, tool.version, tool.description,
        tool.input_schema, tool.output_schema, tool.side_effect,
        tool.data_sensitivity, tool.account_binding, tool.enabled,
        tool.created_at,
        binding.id as binding_id, binding.agent_version_id,
        binding.tool_definition_id, binding.mode_override,
        binding.account_scope, binding.created_at as binding_created_at
      from agent_tool_bindings binding
      join tool_definitions tool
        on tool.owner_id = binding.owner_id and tool.id = binding.tool_definition_id
      where binding.owner_id = ${value.ownerId}
        and binding.agent_version_id = ${value.agentVersionId}
        and tool.enabled = true
      order by tool.name, tool.version, tool.id
    `;
    return rows.map((row) => ({
      ...safeDefinition(row),
      binding: safeBinding({
        id: row.binding_id,
        owner_id: row.owner_id,
        agent_version_id: row.agent_version_id,
        tool_definition_id: row.tool_definition_id,
        mode_override: row.mode_override,
        account_scope: row.account_scope,
        created_at: row.binding_created_at,
      }),
    }));
  }

  return { get, create, bind, listForAgentVersion };
}
