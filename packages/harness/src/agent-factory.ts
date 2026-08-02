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
  tools?: (threadId: string) => readonly HarnessToolBinding[];
}): (threadId: string) => {
  model: ModelPort;
  tools: readonly ToolPort[];
} {
  return (threadId) => {
    const bindings = input.tools?.(threadId) ?? [];
    return {
      model: createResponsesModel({
        endpoint: input.endpoint,
        model: input.model,
        ...(input.instructions === undefined
          ? {}
          : { instructions: input.instructions }),
        ...(input.headers === undefined ? {} : { headers: input.headers }),
        ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
        ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
        tools: bindings.map(({ definition }) => definition),
      }),
      tools: bindings.map(({ port }) => port),
    };
  };
}
