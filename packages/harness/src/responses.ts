import { z } from "zod";

import type { HarnessItem, ModelPort } from "./index.js";

const outputTextSchema = z
  .object({ type: z.literal("output_text"), text: z.string() })
  .passthrough();
const messageSchema = z
  .object({ type: z.literal("message"), content: z.array(outputTextSchema) })
  .passthrough();
const functionCallSchema = z
  .object({
    type: z.literal("function_call"),
    call_id: z.string().min(1),
    name: z.string().min(1),
    arguments: z.string(),
  })
  .passthrough();
const responseSchema = z.object({ output: z.array(z.unknown()) }).passthrough();

export interface ResponsesToolDefinition {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

function toResponsesInput(
  items: readonly HarnessItem[],
): Array<Record<string, unknown>> {
  return items.map((item) => {
    switch (item.type) {
      case "user_message":
        return { role: "user", content: item.text };
      case "assistant_message":
        return { role: "assistant", content: item.text };
      case "assistant_tool_call":
        return {
          type: "function_call",
          call_id: item.callId,
          name: item.toolName,
          arguments: JSON.stringify(item.arguments),
        };
      case "tool_result":
        return {
          type: "function_call_output",
          call_id: item.callId,
          output: item.output,
        };
    }
  });
}

export function createResponsesModel(input: {
  endpoint: string;
  model: string;
  instructions?: string;
  tools?: readonly ResponsesToolDefinition[];
  headers?: Record<string, string>;
  apiKey?: () => Promise<string>;
  fetch?: typeof globalThis.fetch;
}): ModelPort {
  const request = input.fetch ?? globalThis.fetch;
  if (request === undefined)
    throw new Error("HARNESS_FETCH_UNAVAILABLE: fetch is required.");
  return {
    async respond(modelInput) {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        ...input.headers,
      };
      if (input.apiKey !== undefined)
        headers["authorization"] = `Bearer ${await input.apiKey()}`;
      const response = await request(input.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: input.model,
          ...(input.instructions === undefined
            ? {}
            : { instructions: input.instructions }),
          input: toResponsesInput(modelInput.items),
          ...(input.tools === undefined
            ? {}
            : {
                tools: input.tools.map((tool) => ({
                  type: "function",
                  name: tool.name,
                  description: tool.description ?? "",
                  parameters: tool.parameters,
                })),
              }),
        }),
      });
      if (!response.ok)
        throw new Error(
          `HARNESS_MODEL_HTTP_${response.status}: model request failed.`,
        );
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error(
          "HARNESS_MODEL_RESPONSE_INVALID: response was not JSON.",
        );
      }
      const parsed = responseSchema.safeParse(body);
      if (!parsed.success)
        throw new Error(
          "HARNESS_MODEL_RESPONSE_INVALID: missing output items.",
        );
      for (const item of parsed.data.output) {
        const call = functionCallSchema.safeParse(item);
        if (call.success) {
          let arguments_: unknown;
          try {
            arguments_ = JSON.parse(call.data.arguments);
          } catch {
            throw new Error(
              "HARNESS_MODEL_RESPONSE_INVALID: tool arguments are not JSON.",
            );
          }
          const object = z
            .record(z.string(), z.unknown())
            .safeParse(arguments_);
          if (!object.success)
            throw new Error(
              "HARNESS_MODEL_RESPONSE_INVALID: tool arguments must be an object.",
            );
          return {
            kind: "tool_call",
            callId: call.data.call_id,
            toolName: call.data.name,
            arguments: object.data,
          };
        }
        const message = messageSchema.safeParse(item);
        if (message.success)
          return {
            kind: "final",
            text: message.data.content.map((part) => part.text).join(""),
          };
      }
      throw new Error(
        "HARNESS_MODEL_RESPONSE_INVALID: no final message or function call.",
      );
    },
  };
}

export async function compactContext<T>(
  items: readonly T[],
  input: {
    maxItems: number;
    compact: (items: readonly T[]) => Promise<readonly T[]>;
  },
): Promise<readonly T[]> {
  if (!Number.isInteger(input.maxItems) || input.maxItems < 1)
    throw new Error(
      "HARNESS_CONTEXT_LIMIT_INVALID: maxItems must be positive.",
    );
  if (items.length <= input.maxItems) return [...items];
  return [...(await input.compact(items))];
}
