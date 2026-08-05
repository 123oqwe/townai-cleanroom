import { describe, expect, it } from "vitest";
import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

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

describe("runtime telemetry", () => {
  it("does not crash without an exporter configured", async () => {
    resetTracer();
    // withSpan is the shared helper used by transition-service.ts and
    // queue-repository.ts. Without a provider it returns a no-op tracer.
    const result = await withSpan("runtime.lease.claim", async (span) => {
      span.setAttribute("worker.id", "worker-1");
      return { claimed: true };
    });
    expect(result).toEqual({ claimed: true });
  });

  it("creates a span with attributes when a provider is registered", async () => {
    const exporter = setupRecordingProvider();
    try {
      const result = await withSpan(
        "runtime.lease.claim",
        async (span) => {
          span.setAttribute("worker.id", "worker-1");
          span.setAttribute("run.id", "run-123");
          return { claimed: true };
        },
        { attributes: { "run.attempt": 1 } },
      );
      expect(result).toEqual({ claimed: true });

      const spans = exporter.getFinishedSpans();
      expect(spans.length).toBe(1);
      expect(spans[0]?.name).toBe("runtime.lease.claim");
      expect(spans[0]?.attributes?.["worker.id"]).toBe("worker-1");
      expect(spans[0]?.attributes?.["run.id"]).toBe("run-123");
      expect(spans[0]?.attributes?.["run.attempt"]).toBe(1);
    } finally {
      teardownProvider();
    }
  });

  it("records exceptions and sets error status on the span", async () => {
    const exporter = setupRecordingProvider();
    try {
      await expect(
        withSpan("runtime.transition.fail", async () => {
          throw new Error("runtime boom");
        }),
      ).rejects.toThrow("runtime boom");

      const spans = exporter.getFinishedSpans();
      expect(spans.length).toBe(1);
      expect(spans[0]?.name).toBe("runtime.transition.fail");
      expect(spans[0]?.status?.code).toBe(2);
      expect(spans[0]?.status?.message).toBe("runtime boom");
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
