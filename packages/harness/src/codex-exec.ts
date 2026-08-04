/**
 * Codex SDK adapter for the Harness ModelPort.
 *
 * When CODEX_EXEC_ENABLED is true, the runtime uses the official Codex agent
 * (via @openai/codex-sdk from openai/codex) instead of the raw Responses API.
 * This adapter translates HarnessItem[] into Codex Thread input and maps Codex
 * ThreadItem events back to the ModelPort respond() contract.
 *
 * The Codex SDK spawns the Codex CLI as a subprocess. The CLI handles:
 * - Model reasoning and tool-call decisions
 * - Sandbox execution (read-only / workspace-write / danger-full-access)
 * - Approval policies (never / on-request / on-failure / untrusted)
 * - MCP tool calls, command execution, file changes, web search
 *
 * This adapter never fabricates model output. If the Codex CLI is not
 * installed or the API key is missing, it throws explicitly.
 */
import { randomUUID } from "node:crypto";

import type { HarnessItem, ModelPort, ToolPort } from "./index.js";
import type { ResponsesToolDefinition, ResponsesUsage } from "./responses.js";

import {
  Codex,
  type Thread,
  type ThreadItem,
  type Usage,
} from "@openai/codex-sdk";

export interface CodexToolDefinition {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export interface CodexUsage {
  threadId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CodexToolBinding {
  definition: ResponsesToolDefinition;
  port: ToolPort;
}

const outputSchemaShape = {
  type: "object" as const,
  properties: {
    response_type: { type: "string", enum: ["tool_call", "final"] },
    tool_name: { type: "string" },
    tool_arguments: { type: "object", additionalProperties: true },
    final_text: { type: "string" },
  },
  required: ["response_type"],
  additionalProperties: false,
};

function formatItemsAsPrompt(items: readonly HarnessItem[]): string {
  const lines: string[] = [];
  for (const item of items) {
    switch (item.type) {
      case "user_message":
        lines.push(`[user]: ${item.text}`);
        break;
      case "assistant_message":
        lines.push(`[assistant]: ${item.text}`);
        break;
      case "assistant_tool_call":
        lines.push(
          `[assistant_tool_call]: ${item.toolName}(${JSON.stringify(item.arguments)})`,
        );
        break;
      case "tool_result":
        lines.push(`[tool_result(${item.toolName})]: ${item.output}`);
        break;
      case "provider_item":
        break;
    }
  }
  return lines.join("\n");
}

function formatToolDescriptions(
  tools: readonly ResponsesToolDefinition[],
): string {
  if (tools.length === 0) return "";
  const descriptions = tools.map((tool) => {
    const params = JSON.stringify(tool.parameters, null, 2);
    return `${tool.name}: ${tool.description ?? ""}
Parameters: ${params}`;
  });
  return `You have access to the following tools:\n\n${descriptions.join("\n\n")}`;
}

/**
 * Creates a ModelPort backed by the official @openai/codex-sdk.
 *
 * The SDK is loaded statically; the package is a declared dependency. The
 * adapter calls Codex.startThread().run() with the conversation history and
 * tool definitions, then maps the returned ThreadItems to the ModelPort
 * respond() contract. Codex uses its configured model and provider from
 * ~/.codex/config.toml; the harness tool loop, approval system, and thread
 * persistence remain unchanged.
 */
export function createCodexModel(input: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  instructions?: string;
  tools?: readonly ResponsesToolDefinition[];
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
  workingDirectory?: string;
  approvalPolicy?: "never" | "on-request" | "on-failure" | "untrusted";
  skipGitRepoCheck?: boolean;
  onUsage?: (usage: ResponsesUsage) => Promise<void> | void;
}): ModelPort {
  const codex = new Codex({
    ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
    ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
  });

  let thread: Thread | null = null;

  return {
    async respond(modelInput: { items: HarnessItem[] }) {
      const toolSection = formatToolDescriptions(input.tools ?? []);
      const conversation = formatItemsAsPrompt(modelInput.items);
      const systemInstructions = input.instructions ?? "";
      const prompt = [
        systemInstructions.length > 0
          ? `System instructions:\n${systemInstructions}`
          : "",
        toolSection.length > 0
          ? `\n${toolSection}\n\nBased on the conversation, either call a tool or give a final response. Respond ONLY as JSON matching the output schema: {"response_type":"tool_call","tool_name":"...","tool_arguments":{...}} or {"response_type":"final","final_text":"..."}`
          : '\nBased on the conversation, give a final response. Respond ONLY as JSON matching the output schema: {"response_type":"final","final_text":"..."}',
        `\nConversation:\n${conversation}`,
      ]
        .filter(Boolean)
        .join("\n");

      if (thread === null) {
        thread = codex.startThread({
          ...(input.model === undefined ? {} : { model: input.model }),
          ...(input.sandboxMode === undefined
            ? {}
            : { sandboxMode: input.sandboxMode }),
          ...(input.workingDirectory === undefined
            ? {}
            : { workingDirectory: input.workingDirectory }),
          ...(input.approvalPolicy === undefined
            ? {}
            : { approvalPolicy: input.approvalPolicy }),
          ...(input.skipGitRepoCheck === undefined
            ? {}
            : { skipGitRepoCheck: input.skipGitRepoCheck }),
        });
      }

      const result = await thread.run(prompt, {
        outputSchema: outputSchemaShape,
      });

      if (input.onUsage !== undefined && result.usage !== null) {
        const threadId = thread.id ?? randomUUID();
        await input.onUsage({
          responseId: threadId,
          inputTokens: result.usage.input_tokens,
          outputTokens: result.usage.output_tokens,
          totalTokens:
            result.usage.input_tokens + result.usage.output_tokens,
        });
      }

      const parsed = parseStructuredOutput(result.finalResponse);
      if (parsed !== null) {
        if (parsed.response_type === "tool_call") {
          if (
            parsed.tool_name === undefined ||
            parsed.tool_arguments === undefined
          )
            throw new Error(
              "CODEX_OUTPUT_INVALID: tool_call missing tool_name or tool_arguments.",
            );
          return {
            kind: "tool_call" as const,
            callId: randomUUID(),
            toolName: parsed.tool_name,
            arguments: parsed.tool_arguments,
          };
        }
        if (parsed.final_text === undefined)
          throw new Error(
            "CODEX_OUTPUT_INVALID: final response missing final_text.",
          );
        return { kind: "final" as const, text: parsed.final_text };
      }

      // Fallback: scan ThreadItems for agent_message or tool calls
      for (const item of result.items) {
        const itemType = item["type"] as string | undefined;
        if (itemType === "agent_message") {
          const text = (item as Record<string, unknown>)["text"] as
            | string
            | undefined;
          if (text !== undefined)
            return { kind: "final" as const, text };
        }
      }
      // If there's a finalResponse string, use it
      if (result.finalResponse.length > 0)
        return { kind: "final" as const, text: result.finalResponse };

      throw new Error(
        "CODEX_RESPONSE_INVALID: no tool call or final message returned.",
      );
    },
  };
}

interface ParsedOutput {
  response_type: "tool_call" | "final";
  tool_name?: string;
  tool_arguments?: Record<string, unknown>;
  final_text?: string;
}

function parseStructuredOutput(text: string): ParsedOutput | null {
  if (text.trim() === "") return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "response_type" in parsed &&
      ((parsed as { response_type: unknown }).response_type === "tool_call" ||
        (parsed as { response_type: unknown }).response_type === "final")
    ) {
      const obj = parsed as Record<string, unknown>;
      return {
        response_type: obj["response_type"] as "tool_call" | "final",
        ...(typeof obj["tool_name"] === "string"
          ? { tool_name: obj["tool_name"] }
          : {}),
        ...(typeof obj["tool_arguments"] === "object" &&
        obj["tool_arguments"] !== null
          ? {
              tool_arguments: obj["tool_arguments"] as Record<string, unknown>,
            }
          : {}),
        ...(typeof obj["final_text"] === "string"
          ? { final_text: obj["final_text"] }
          : {}),
      };
    }
  } catch {
    // Not JSON - treat as plain text final response
  }
  return null;
}

/**
 * Creates a Codex-backed agent factory compatible with the existing
 * createResponsesAgentFactory interface. When Codex is configured, the
 * runtime uses this instead of the raw Responses API adapter.
 */
export function createCodexAgentFactory(input: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  instructions?: string;
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
  workingDirectory?: string;
  approvalPolicy?: "never" | "on-request" | "on-failure" | "untrusted";
  skipGitRepoCheck?: boolean;
  onUsage?: (usage: ResponsesUsage) => Promise<void> | void;
  tools?: (
    threadId: string,
    agentVersionId?: string,
  ) => readonly CodexToolBinding[];
  agentVersionForThread?: (
    agentVersionId: string | undefined,
  ) => { instructions: string } | undefined;
}): (
  threadId: string,
  agentVersionId?: string,
) => { model: ModelPort; tools: readonly ToolPort[] } {
  return (threadId, agentVersionId) => {
    const selected = input.agentVersionForThread?.(agentVersionId);
    const bindings = input.tools?.(threadId, agentVersionId) ?? [];
    return {
      model: createCodexModel({
        ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
        ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
        ...(input.model === undefined ? {} : { model: input.model }),
        ...((selected?.instructions ?? input.instructions) === undefined
          ? {}
          : {
              instructions: selected?.instructions ?? input.instructions,
            }),
        ...(input.sandboxMode === undefined
          ? {}
          : { sandboxMode: input.sandboxMode }),
        ...(input.workingDirectory === undefined
          ? {}
          : { workingDirectory: input.workingDirectory }),
        ...(input.approvalPolicy === undefined
          ? {}
          : { approvalPolicy: input.approvalPolicy }),
        ...(input.skipGitRepoCheck === undefined
          ? {}
          : { skipGitRepoCheck: input.skipGitRepoCheck }),
        ...(input.onUsage === undefined ? {} : { onUsage: input.onUsage }),
        tools: bindings.map(({ definition }) => definition),
      }),
      tools: bindings.map(({ port }) => port),
    };
  };
}
