import { describe, expect, it } from "vitest";

import { newId } from "../src/id.js";
import { serverEventKindSchema, serverEventSchema } from "../src/response.js";

function validEvent() {
  return {
    id: newId<"session-event">(),
    sessionId: newId<"runtime-session">(),
    runId: newId<"session-run">(),
    sequence: 1,
    kind: "run_started" as const,
    payload: { trigger: "manual" },
    createdAt: "2026-08-06T00:00:00.000Z",
  };
}

describe("server event wire contract", () => {
  it("accepts a complete server-sent event payload", () => {
    const event = validEvent();
    expect(serverEventSchema.parse(event)).toEqual(event);
  });

  it("accepts every documented session event kind", () => {
    const kinds = [
      "run_queued",
      "run_started",
      "phase_changed",
      "input_observed",
      "assistant_output_recorded",
      "run_waiting",
      "run_resumed",
      "run_completed",
      "run_failed",
      "run_cancelled",
      "tool_call_proposed",
      "policy_decided",
      "approval_requested",
      "approval_resolved",
      "tool_started",
      "tool_succeeded",
      "tool_failed",
    ];
    for (const kind of kinds) {
      expect(serverEventKindSchema.parse(kind)).toBe(kind);
    }
  });

  it.each([0, -1, 1.5])("rejects invalid sequence %s", (sequence) => {
    expect(() =>
      serverEventSchema.parse({ ...validEvent(), sequence }),
    ).toThrow();
  });

  it("rejects an unknown event kind", () => {
    expect(() =>
      serverEventSchema.parse({ ...validEvent(), kind: "tool_planned" }),
    ).toThrow();
  });

  it("rejects a timestamp without an explicit UTC offset", () => {
    expect(() =>
      serverEventSchema.parse({
        ...validEvent(),
        createdAt: "2026-08-06T00:00:00",
      }),
    ).toThrow();
  });

  it("rejects extra fields under strict parsing", () => {
    expect(() =>
      serverEventSchema.parse({ ...validEvent(), runState: "running" }),
    ).toThrow();
  });
});
