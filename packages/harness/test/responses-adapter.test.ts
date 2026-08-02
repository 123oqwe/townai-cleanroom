import { describe, expect, it } from "vitest";
import { createResponsesModel, compactContext } from "../src/responses.js";

describe("Responses API adapter", () => {
  it("maps a Responses message into a final harness response", async () => {
    let request: RequestInit | undefined;
    const model = createResponsesModel({
      endpoint: "https://model.example.invalid/v1/responses",
      model: "test-model",
      fetch: async (_url, init) => {
        request = init;
        return new Response(
          JSON.stringify({
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: "hello" }],
              },
            ],
          }),
          { status: 200 },
        );
      },
    });
    await expect(
      model.respond({ items: [{ type: "user_message", text: "hi" }] }),
    ).resolves.toEqual({ kind: "final", text: "hello" });
    expect(JSON.parse(String(request?.body))).toMatchObject({
      model: "test-model",
      input: [{ role: "user", content: "hi" }],
    });
  });

  it("maps a function_call item and never invents a tool result", async () => {
    const model = createResponsesModel({
      endpoint: "https://model.example.invalid/v1/responses",
      model: "test-model",
      fetch: async () =>
        new Response(
          JSON.stringify({
            output: [
              {
                type: "function_call",
                call_id: "call-1",
                name: "read",
                arguments: '{"key":"x"}',
              },
            ],
          }),
          { status: 200 },
        ),
    });
    await expect(
      model.respond({ items: [{ type: "user_message", text: "read" }] }),
    ).resolves.toEqual({
      kind: "tool_call",
      callId: "call-1",
      toolName: "read",
      arguments: { key: "x" },
    });
  });

  it("compacts only when the context budget is exceeded", async () => {
    const items = [
      { type: "user_message" as const, text: "one" },
      { type: "assistant_message" as const, text: "two" },
      { type: "user_message" as const, text: "three" },
    ];
    await expect(
      compactContext(items, {
        maxItems: 2,
        compact: async (value) => [
          {
            type: "assistant_message" as const,
            text: `summary:${value.length}`,
          },
        ],
      }),
    ).resolves.toEqual([{ type: "assistant_message", text: "summary:3" }]);
    await expect(
      compactContext(items.slice(0, 2), {
        maxItems: 2,
        compact: async () => [],
      }),
    ).resolves.toEqual(items.slice(0, 2));
  });
});
