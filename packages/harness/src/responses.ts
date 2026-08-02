import { z } from "zod";

import type { HarnessItem, ModelPort } from "./index.js";

const outputTextSchema = z
  .object({ type: z.literal("output_text"), text: z.string() })
  .passthrough();
const refusalSchema = z
  .object({ type: z.literal("refusal"), refusal: z.string() })
  .passthrough();
const messageSchema = z
  .object({
    type: z.literal("message"),
    content: z.array(z.union([outputTextSchema, refusalSchema])),
  })
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
        return (
          item.providerItem ?? {
            type: "function_call",
            call_id: item.callId,
            name: item.toolName,
            arguments: JSON.stringify(item.arguments),
          }
        );
      case "tool_result":
        return {
          type: "function_call_output",
          call_id: item.callId,
          output: item.output,
        };
      case "provider_item":
        return item.item;
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
      const headers = new Headers(input.headers);
      headers.set("content-type", "application/json");
      if (input.apiKey !== undefined)
        headers.set("authorization", `Bearer ${await input.apiKey()}`);
      const response = await request(input.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: input.model,
          ...(input.instructions === undefined
            ? {}
            : { instructions: input.instructions }),
          input: toResponsesInput(modelInput.items),
          parallel_tool_calls: false,
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
      const functionCalls = parsed.data.output.filter(
        (item) => functionCallSchema.safeParse(item).success,
      );
      for (const item of parsed.data.output) {
        if (
          z.record(z.string(), z.unknown()).safeParse(item).success &&
          (item as { type?: unknown }).type === "function_call" &&
          !functionCallSchema.safeParse(item).success
        )
          throw new Error(
            "HARNESS_MODEL_RESPONSE_INVALID: malformed function call item.",
          );
      }
      if (functionCalls.length > 1)
        throw new Error(
          "HARNESS_MODEL_RESPONSE_INVALID: multiple function calls are unsupported.",
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
          const providerItems = parsed.data.output
            .filter((candidate) => candidate !== item)
            .filter(
              (candidate) =>
                z.record(z.string(), z.unknown()).safeParse(candidate).success,
            )
            .map((candidate) => ({
              type: "provider_item" as const,
              item: candidate as Record<string, unknown>,
            }));
          return {
            kind: "tool_call",
            callId: call.data.call_id,
            toolName: call.data.name,
            arguments: object.data,
            providerItem: item as Record<string, unknown>,
            ...(providerItems.length === 0 ? {} : { providerItems }),
          };
        }
        const message = messageSchema.safeParse(item);
        if (message.success) {
          const providerItems = parsed.data.output
            .filter((candidate) => candidate !== item)
            .filter(
              (candidate) =>
                z.record(z.string(), z.unknown()).safeParse(candidate).success,
            )
            .map((candidate) => ({
              type: "provider_item" as const,
              item: candidate as Record<string, unknown>,
            }));
          return {
            kind: "final",
            text: message.data.content
              .map((part) =>
                part.type === "refusal" ? part.refusal : part.text,
              )
              .join(""),
            ...(providerItems.length === 0 ? {} : { providerItems }),
          };
        }
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
    validate?: (items: readonly T[]) => void;
  },
): Promise<readonly T[]> {
  if (!Number.isInteger(input.maxItems) || input.maxItems < 1)
    throw new Error(
      "HARNESS_CONTEXT_LIMIT_INVALID: maxItems must be positive.",
    );
  if (items.length <= input.maxItems) {
    const unchanged = [...items];
    input.validate?.(unchanged);
    return unchanged;
  }
  const compacted = [...(await input.compact(items))];
  if (compacted.length > input.maxItems)
    throw new Error(
      "HARNESS_CONTEXT_LIMIT_EXCEEDED: context compaction exceeded maxItems.",
    );
  input.validate?.(compacted);
  return compacted;
}

/** Fail-closed compaction for Harness history: tool outputs cannot be orphaned. */
export async function compactHarnessContext(
  items: readonly HarnessItem[],
  input: {
    maxItems: number;
    compact: (items: readonly HarnessItem[]) => Promise<readonly HarnessItem[]>;
  },
): Promise<readonly HarnessItem[]> {
  return compactContext(items, {
    ...input,
    validate(compacted) {
      const calls = new Set(
        compacted
          .filter((item) => item.type === "assistant_tool_call")
          .map((item) => item.callId),
      );
      const results = new Set(
        compacted
          .filter((item) => item.type === "tool_result")
          .map((item) => item.callId),
      );
      const seenCall = new Set<string>();
      for (const item of compacted) {
        if (item.type === "tool_result" && !calls.has(item.callId))
          throw new Error(
            `HARNESS_CONTEXT_INVALID: tool result ${item.callId} has no matching tool call.`,
          );
        if (item.type === "tool_result" && !seenCall.has(item.callId))
          throw new Error(
            `HARNESS_CONTEXT_INVALID: tool result ${item.callId} precedes its tool call.`,
          );
        if (item.type === "assistant_tool_call") seenCall.add(item.callId);
        if (
          item.type === "provider_item" &&
          item.item["type"] === "function_call"
        ) {
          const callId = item.item["call_id"];
          if (typeof callId !== "string" || !calls.has(callId))
            throw new Error(
              "HARNESS_CONTEXT_INVALID: provider function call is not paired with a tool call.",
            );
        }
      }
      for (const callId of calls)
        if (!results.has(callId))
          throw new Error(
            `HARNESS_CONTEXT_INVALID: tool call ${callId} has no matching tool result.`,
          );
    },
  });
}
