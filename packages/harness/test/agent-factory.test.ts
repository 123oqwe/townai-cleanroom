import { describe, expect, it } from "vitest";

import { createResponsesAgentFactory } from "../src/agent-factory.js";

describe("Responses agent factory", () => {
  it("binds provider tools and ports without inventing execution", async () => {
    let body: Record<string, unknown> | undefined;
    const factory = createResponsesAgentFactory({
      endpoint: "https://model.example.invalid/v1/responses",
      model: "test-model",
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: "ok" }],
              },
            ],
          }),
          { status: 200 },
        );
      },
      tools: (threadId) => [
        {
          definition: {
            name: `read-${threadId}`,
            description: "Read a record",
            parameters: { type: "object", properties: {} },
          },
          port: {
            name: `read-${threadId}`,
            async execute() {
              return { kind: "result", output: "real result" as const };
            },
          },
        },
      ],
    });
    const agent = factory("thread-1");
    await expect(
      agent.model.respond({ items: [{ type: "user_message", text: "hi" }] }),
    ).resolves.toEqual({ kind: "final", text: "ok" });
    expect(agent.tools).toHaveLength(1);
    expect(body?.["tools"]).toEqual([
      {
        type: "function",
        name: "read-thread-1",
        description: "Read a record",
        parameters: { type: "object", properties: {} },
      },
    ]);
  });
});
