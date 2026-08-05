import { describe, expect, it } from "vitest";
import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

import {
  createHarness,
  type HarnessEvent,
  type ModelPort,
  type ToolPort,
} from "../src/index.js";
import { getTracer, resetTracer, withSpan } from "../src/telemetry.js";

function setupRecordingProvider(): InMemorySpanExporter {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
  resetTracer();
  return exporter;
}

function teardownProvider(): void {
  trace.disable();
  resetTracer();
}

describe("harness telemetry", () => {
  it("does not crash without an exporter configured", async () => {
    resetTracer();
    const events: HarnessEvent[] = [];
    const model: ModelPort = {
      async respond() {
        return { kind: "final", text: "done" };
      },
    };
    const tool: ToolPort = {
      name: "noop_tool",
      async execute() {
        return { kind: "result", output: "ok" };
      },
    };
    const harness = createHarness({
      model,
      tools: [tool],
      emit: (event) => events.push(event),
    });
    const result = await harness.run({ userText: "hi" });
    expect(result).toEqual({ kind: "completed", text: "done" });
    expect(events.length).toBeGreaterThan(0);
  });

  it("creates spans around tool execution when a provider is registered", async () => {
    const exporter = setupRecordingProvider();
    try {
      const model: ModelPort = {
        async respond(input) {
          const last = input.items.at(-1);
          if (last?.type === "user_message") {
            return {
              kind: "tool_call",
              callId: "call-1",
              toolName: "echo_tool",
              arguments: { value: "hello" },
            };
          }
          return { kind: "final", text: "The value is hello." };
        },
      };
      const tool: ToolPort = {
        name: "echo_tool",
        async execute(args) {
          return { kind: "result", output: `value:${String(args["value"])}` };
        },
      };
      const harness = createHarness({
        model,
        tools: [tool],
        emit: () => undefined,
      });
      const result = await harness.run({ userText: "echo hello" });
      expect(result).toEqual({
        kind: "completed",
        text: "The value is hello.",
      });

      const spans = exporter.getFinishedSpans();
      expect(spans.length).toBeGreaterThanOrEqual(1);
      const toolSpans = spans.filter((s) => s.name === "tool.execute");
      expect(toolSpans.length).toBe(1);
      expect(toolSpans[0]?.attributes?.["tool.name"]).toBe("echo_tool");
      expect(toolSpans[0]?.attributes?.["tool.callId"]).toBe("call-1");
    } finally {
      teardownProvider();
    }
  });

  it("withSpan propagates exceptions and ends the span", async () => {
    const exporter = setupRecordingProvider();
    try {
      await expect(
        withSpan("test.error", async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");

      const spans = exporter.getFinishedSpans();
      expect(spans.length).toBe(1);
      expect(spans[0]?.status?.code).toBe(2);
    } finally {
      teardownProvider();
    }
  });

  it("getTracer returns a tracer without crashing", () => {
    resetTracer();
    const tracer = getTracer();
    expect(tracer).toBeDefined();
    const span = tracer.startSpan("test");
    expect(span).toBeDefined();
    span.end();
  });
});
