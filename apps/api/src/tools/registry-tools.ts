import { z } from "zod";
import { createHash } from "node:crypto";

import {
  createPolicyAwareHarnessTool,
  type HarnessToolBinding,
} from "@town/harness";
import type { AgentRepository, ThreadRepository } from "@town/agents";
import { AgentError, approvalModeSchema } from "@town/agents";
import type { SessionRepository } from "@town/runtime";
import type { Id } from "@town/contracts";
import {
  type AgentToolBinding,
  type McpClient,
  type McpRemoteTool,
  type ToolDefinition,
  type ToolExecutionRepository,
} from "@town/tools";

const invokeRoutineArguments = z
  .object({
    routineId: z.uuidv7(),
    input: z.string().trim().min(1).max(50_000),
  })
  .strict();

export function createInvokeRoutineHarnessBinding(input: {
  ownerId: Id<"user">;
  threadId: string;
  agents: AgentRepository;
  threads: ThreadRepository;
  sessions: SessionRepository;
}): HarnessToolBinding {
  return createPolicyAwareHarnessTool({
    definition: {
      name: "invoke_routine",
      description: "Queue an explicitly allowlisted child Routine.",
      parameters: {
        type: "object",
        properties: {
          routineId: { type: "string", format: "uuid" },
          input: { type: "string", minLength: 1, maxLength: 50_000 },
        },
        required: ["routineId", "input"],
        additionalProperties: false,
      },
    },
    decide: () => "approval_required",
    async execute(arguments_) {
      const value = invokeRoutineArguments.parse(arguments_);
      const parent = await input.threads.get(
        input.ownerId,
        input.threadId as Id<"thread">,
      );
      const child = await input.agents.getRoutine(
        input.ownerId,
        value.routineId as Id<"agent">,
      );
      let parentAgent;
      try {
        const personal = await input.agents.getPersonal(input.ownerId);
        parentAgent =
          personal.id === parent.agentId
            ? personal
            : await input.agents.getRoutine(input.ownerId, parent.agentId);
      } catch (error) {
        if (!(error instanceof AgentError) || error.code !== "AGENT_NOT_FOUND")
          throw error;
        parentAgent = await input.agents.getRoutine(
          input.ownerId,
          parent.agentId,
        );
      }
      if (
        !parentAgent.activeVersion.snapshot.callableRoutineIds.includes(
          child.id,
        )
      )
        throw new Error("HARNESS_ROUTINE_NOT_ALLOWLISTED");
      const childThread = await input.threads.createTask({
        ownerId: input.ownerId,
        agentId: child.id,
        title: `Child Routine: ${child.activeVersion.snapshot.displayName}`,
        approvalMode: approvalModeSchema.parse(
          child.activeVersion.snapshot.defaultApprovalMode,
        ),
      });
      const idempotencyKey = `invoke:${input.threadId}:${child.id}:${createHash("sha256").update(value.input).digest("base64url")}`;
      const submission = await input.sessions.submitMessage({
        ownerId: input.ownerId,
        threadId: childThread.id,
        idempotencyKey,
        text: value.input,
        mentions: [],
      });
      return {
        kind: "result",
        output: JSON.stringify({
          routineId: child.id,
          threadId: childThread.id,
          sessionId: submission.session.id,
          runId: submission.run.id,
          queued: true,
          replayed: submission.replayed,
        }),
      };
    },
  });
}

/**
 * Converts only registry definitions with an explicitly registered handler.
 * Definitions without a handler are intentionally omitted, never stubbed.
 */

export function createRegistryHarnessBindings(input: {
  ownerId: Id<"user">;
  threadId: string;
  definitions: ReadonlyArray<ToolDefinition & { binding: AgentToolBinding }>;
  handlers: ReadonlyMap<
    string,
    (
      arguments_: Record<string, unknown>,
    ) => ReturnType<NonNullable<HarnessToolBinding["port"]>["execute"]>
  >;
}): HarnessToolBinding[] {
  const latestByName = new Map<
    string,
    ToolDefinition & { binding: AgentToolBinding }
  >();
  for (const definition of input.definitions) {
    const current = latestByName.get(definition.name);
    if (current === undefined || definition.version > current.version) {
      latestByName.set(definition.name, definition);
    }
  }
  return [...latestByName.values()].flatMap((definition) => {
    const handler = input.handlers.get(definition.name);
    if (handler === undefined || definition.ownerId !== input.ownerId)
      return [];
    const binding = createPolicyAwareHarnessTool({
      definition: {
        name: definition.name,
        description: definition.description,
        parameters: definition.inputSchema,
      },
      decide: () => {
        if (definition.sideEffect === "read") return "allow";
        if (definition.binding.modeOverride === "read_only") return "deny";
        return "approval_required";
      },
      execute: handler,
    });
    return [binding];
  });
}

function mcpToolName(serverName: string, toolName: string): string {
  const safeServer = serverName.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 60);
  const safeTool = toolName.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 120);
  return `mcp_${safeServer}_${safeTool}`;
}

function mcpReadOnlyHint(tool: McpRemoteTool): boolean {
  return tool.annotations?.["readOnlyHint"] === true;
}

/**
 * Converts only a successfully discovered, explicitly bound MCP tool into a
 * policy-aware Harness port. Discovery failures are kept outside this helper;
 * callers must decide whether an unavailable provider is a hard error.
 */

export function createMcpHarnessBindings(input: {
  client: Pick<McpClient, "callTool">;
  serverName: string;
  tools: readonly McpRemoteTool[];
  modeOverride: "read_only" | "approval_required" | "autonomous" | null;
  durable?: {
    execution: ToolExecutionRepository;
    ownerId: Id<"user">;
    sessionId: Id<"runtime-session">;
    runId: Id<"session-run">;
    leaseToken: string;
    agentVersionId: Id<"agent-version">;
    toolDefinitionIds: ReadonlyMap<string, Id<"tool-definition">>;
  };
}): HarnessToolBinding[] {
  return input.tools.map((tool) => {
    const name = mcpToolName(input.serverName, tool.name);
    const readOnly = mcpReadOnlyHint(tool);
    const decision = () => {
      if (input.modeOverride === "read_only" && !readOnly)
        return "deny" as const;
      if (readOnly && input.modeOverride !== "approval_required")
        return "allow" as const;
      return "approval_required" as const;
    };
    return createPolicyAwareHarnessTool({
      definition: {
        name,
        ...(tool.description === undefined
          ? {}
          : { description: tool.description }),
        parameters: tool.inputSchema,
      },
      decide: decision,
      execute: async (arguments_, context) => {
        const durable = input.durable;
        const callId =
          context?.callId ?? `${name}:${JSON.stringify(arguments_)}`;
        const toolDefinitionId = durable?.toolDefinitionIds.get(name);
        if (durable !== undefined && toolDefinitionId === undefined)
          throw new Error(
            "MCP_TOOL_DEFINITION_NOT_FOUND: discovered definition is missing.",
          );
        const proposed = durable
          ? await durable.execution.propose({
              ownerId: durable.ownerId,
              sessionId: durable.sessionId,
              runId: durable.runId,
              leaseToken: durable.leaseToken,
              agentVersionId: durable.agentVersionId,
              toolDefinitionId: toolDefinitionId as Id<"tool-definition">,
              stepKey: `mcp:${name}`,
              idempotencyKey: `harness:${callId}`,
              arguments: arguments_,
              approvalGranted: context?.approvalGranted ?? false,
              policy: {
                sessionMode: "allow_all",
                routineMode: "autonomous",
                perToolOverride: null,
                sideEffect: readOnly ? "read" : "external_write",
                dataSensitivity: "private",
                inputTrust: "untrusted_data",
                targetIsSelf: false,
                targetIsTrusted: false,
                accountBound: false,
              },
            })
          : null;
        if (proposed?.toolCall.status === "waiting_approval")
          throw new Error(
            "HARNESS_TOOL_APPROVAL_REQUIRED: durable approval is required.",
          );
        if (durable && proposed !== null) {
          await durable.execution.start({
            ownerId: durable.ownerId,
            toolCallId: proposed.toolCall.id,
            leaseToken: durable.leaseToken,
          });
        }
        try {
          const result = await input.client.callTool(tool.name, arguments_);
          const output = JSON.stringify(result);
          if (output === undefined)
            throw new Error("MCP_TOOL_RESULT_INVALID: result was not JSON.");
          if (output.length > 100_000)
            throw new Error(
              "MCP_TOOL_RESULT_TOO_LARGE: result exceeded 100KB.",
            );
          if (durable && proposed !== null)
            await durable.execution.succeed({
              ownerId: durable.ownerId,
              toolCallId: proposed.toolCall.id,
              leaseToken: durable.leaseToken,
              result: { output },
            });
          return { kind: "result", output };
        } catch (error) {
          if (durable && proposed !== null)
            await durable.execution
              .fail({
                ownerId: durable.ownerId,
                toolCallId: proposed.toolCall.id,
                leaseToken: durable.leaseToken,
                errorCode:
                  error instanceof Error ? error.name : "MCP_TOOL_FAILURE",
              })
              .catch(() => undefined);
          throw error;
        }
      },
    });
  });
}
