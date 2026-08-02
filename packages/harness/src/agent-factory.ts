import {
  createResponsesModel,
  type ResponsesToolDefinition,
} from "./responses.js";
import type { ModelPort, ToolPort } from "./index.js";

export interface HarnessToolBinding {
  definition: ResponsesToolDefinition;
  port: ToolPort;
}

/** Builds real provider-backed agents; it never fabricates model output or tool results. */
export function createResponsesAgentFactory(input: {
  endpoint: string;
  model: string;
  instructions?: string;
  headers?: Record<string, string>;
  apiKey?: () => Promise<string>;
  fetch?: typeof globalThis.fetch;
  tools?: (
    threadId: string,
    agentVersionId?: string,
  ) => readonly HarnessToolBinding[];
  agentVersionForThread?: (
    agentVersionId: string | undefined,
  ) => { instructions: string } | undefined;
}): (
  threadId: string,
  agentVersionId?: string,
) => {
  model: ModelPort;
  tools: readonly ToolPort[];
} {
  return (threadId, agentVersionId) => {
    const selected = input.agentVersionForThread?.(agentVersionId);
    const bindings = input.tools?.(threadId, agentVersionId) ?? [];
    const definitionNames = new Set<string>();
    const portNames = new Set<string>();
    for (const { definition, port } of bindings) {
      if (
        definition.name.trim() === "" ||
        port.name.trim() === "" ||
        definition.name !== port.name
      )
        throw new Error(
          "HARNESS_AGENT_TOOL_INVALID: provider definition and execution port names must match.",
        );
      if (definitionNames.has(definition.name) || portNames.has(port.name))
        throw new Error(
          `HARNESS_AGENT_TOOL_DUPLICATE: tool ${definition.name} is bound more than once.`,
        );
      definitionNames.add(definition.name);
      portNames.add(port.name);
    }
    return {
      model: createResponsesModel({
        endpoint: input.endpoint,
        model: input.model,
        ...((selected?.instructions ?? input.instructions) === undefined
          ? {}
          : { instructions: selected?.instructions ?? input.instructions }),
        ...(input.headers === undefined ? {} : { headers: input.headers }),
        ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
        ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
        tools: bindings.map(({ definition }) => definition),
      }),
      tools: bindings.map(({ port }) => port),
    };
  };
}
