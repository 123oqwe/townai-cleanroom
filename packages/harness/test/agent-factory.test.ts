import { describe, expect, it } from "vitest";

import { createResponsesAgentFactory } from "../src/agent-factory.js";
import { createModelRouter } from "../src/model-router.js";

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

  it("rejects mismatched or duplicate provider/port names", () => {
    const make = (bindings: Array<{ name: string; portName?: string }>) =>
      createResponsesAgentFactory({
        endpoint: "https://model.example.invalid/v1/responses",
        model: "test-model",
        tools: () =>
          bindings.map(({ name, portName }) => ({
            definition: {
              name,
              description: "tool",
              parameters: { type: "object" },
            },
            port: {
              name: portName ?? name,
              async execute() {
                return { kind: "result", output: "ok" as const };
              },
            },
          })),
      });
    const mismatched = make([{ name: "read", portName: "write" }]);
    expect(() => mismatched("thread")).toThrow("names must match");
    const duplicated = make([{ name: "read" }, { name: "read" }]);
    expect(() => duplicated("thread")).toThrow("bound more than once");
  });

  it("uses an explicit operation router when supplied", async () => {
    const router = createModelRouter({
      routes: [
        {
          id: "routine-primary",
          operation: "routine",
          provider: "test",
          model: "routine-model",
          priority: 1,
          port: {
            respond: async () => ({ kind: "final", text: "routed" }),
          },
        },
      ],
    });
    const factory = createResponsesAgentFactory({
      endpoint: "https://model.example.invalid/v1/responses",
      model: "unused-default",
      modelRouter: router,
      modelOperation: "routine",
    });

    await expect(
      factory("thread").model.respond({
        items: [{ type: "user_message", text: "run" }],
      }),
    ).resolves.toEqual({ kind: "final", text: "routed" });
  });

  it("can build an operation router per thread after tool bindings are known", async () => {
    const factory = createResponsesAgentFactory({
      endpoint: "https://model.example.invalid/v1/responses",
      model: "unused-default",
      modelRouterFactory: () =>
        createModelRouter({
          routes: [
            {
              id: "fallback",
              operation: "interactive",
              provider: "test",
              model: "fallback-model",
              priority: 1,
              port: {
                respond: async () => ({
                  kind: "final",
                  text: "factory-routed",
                }),
              },
            },
          ],
        }),
    });

    await expect(
      factory("thread").model.respond({
        items: [{ type: "user_message", text: "hello" }],
      }),
    ).resolves.toMatchObject({ kind: "final", text: "factory-routed" });
  });
});
