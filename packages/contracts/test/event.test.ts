import { describe, expect, it } from "vitest";

import { eventEnvelopeSchema } from "../src/event.js";
import { newId } from "../src/id.js";

function validEvent() {
  return {
    eventId: newId<"event">(),
    aggregateType: "session",
    aggregateId: newId<"session">(),
    sequence: 1,
    type: "session.queued",
    version: 1,
    occurredAt: new Date().toISOString(),
    actorId: null,
    correlationId: newId<"correlation">(),
    causationId: null,
    data: { trigger: "manual" },
  };
}

describe("event envelope", () => {
  it("accepts a complete wire-safe event", () => {
    const event = validEvent();

    expect(eventEnvelopeSchema.parse(event)).toEqual(event);
  });

  it.each([0, -1, 1.5])("rejects invalid sequence %s", (sequence) => {
    expect(() =>
      eventEnvelopeSchema.parse({ ...validEvent(), sequence }),
    ).toThrow();
  });

  it("rejects a timestamp without an explicit UTC offset", () => {
    expect(() =>
      eventEnvelopeSchema.parse({
        ...validEvent(),
        occurredAt: "2026-08-02T12:00:00",
      }),
    ).toThrow();
  });

  it("rejects non-object event data", () => {
    expect(() =>
      eventEnvelopeSchema.parse({ ...validEvent(), data: "text" }),
    ).toThrow();
  });
});
