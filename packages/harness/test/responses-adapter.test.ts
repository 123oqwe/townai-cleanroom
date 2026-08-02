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
    ).resolves.toMatchObject({
      kind: "tool_call",
      callId: "call-1",
      toolName: "read",
      arguments: { key: "x" },
    });
  });

  it("rejects multiple function calls instead of silently dropping one", async () => {
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
                name: "one",
                arguments: "{}",
              },
              {
                type: "function_call",
                call_id: "call-2",
                name: "two",
                arguments: "{}",
              },
            ],
          }),
          { status: 200 },
        ),
    });
    await expect(
      model.respond({ items: [{ type: "user_message", text: "go" }] }),
    ).rejects.toThrow("multiple function calls");
  });

  it("normalizes authorization headers and supports refusal output", async () => {
    let headers: Headers | undefined;
    const model = createResponsesModel({
      endpoint: "https://model.example.invalid/v1/responses",
      model: "test-model",
      headers: { Authorization: "Bearer attacker" },
      apiKey: async () => "secret",
      fetch: async (_url, init) => {
        headers = new Headers(init?.headers);
        return new Response(
          JSON.stringify({
            output: [
              {
                type: "message",
                content: [{ type: "refusal", refusal: "cannot comply" }],
              },
            ],
          }),
          { status: 200 },
        );
      },
    });
    await expect(
      model.respond({ items: [{ type: "user_message", text: "no" }] }),
    ).resolves.toEqual({ kind: "final", text: "cannot comply" });
    expect(headers?.get("authorization")).toBe("Bearer secret");
  });

  it("preserves provider output items for the next request", async () => {
    let body: Record<string, unknown> | undefined;
    let calls = 0;
    const model = createResponsesModel({
      endpoint: "https://model.example.invalid/v1/responses",
      model: "test-model",
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        calls += 1;
        return new Response(
          JSON.stringify({
            output:
              calls === 1
                ? [
                    { id: "rs_1", type: "reasoning", summary: [] },
                    {
                      type: "function_call",
                      call_id: "call-1",
                      name: "read",
                      arguments: "{}",
                      status: "completed",
                    },
                  ]
                : [
                    {
                      type: "message",
                      content: [{ type: "output_text", text: "done" }],
                    },
                  ],
          }),
          { status: 200 },
        );
      },
    });
    const first = await model.respond({
      items: [{ type: "user_message", text: "go" }],
    });
    expect(first.kind).toBe("tool_call");
    if (first.kind !== "tool_call") throw new Error("expected tool call");
    await model.respond({
      items: [
        { type: "user_message", text: "go" },
        ...(first.providerItems ?? []),
        {
          type: "assistant_tool_call",
          callId: first.callId,
          toolName: first.toolName,
          arguments: first.arguments,
          ...(first.providerItem === undefined
            ? {}
            : { providerItem: first.providerItem }),
        },
        {
          type: "tool_result",
          callId: "call-1",
          toolName: "read",
          output: "ok",
        },
      ],
    });
    expect(body?.["input"]).toEqual([
      { role: "user", content: "go" },
      { id: "rs_1", type: "reasoning", summary: [] },
      {
        type: "function_call",
        call_id: "call-1",
        name: "read",
        arguments: "{}",
        status: "completed",
      },
      { type: "function_call_output", call_id: "call-1", output: "ok" },
    ]);
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
    await expect(
      compactContext(items, { maxItems: 2, compact: async () => items }),
    ).rejects.toThrow("context compaction exceeded");
  });
});
