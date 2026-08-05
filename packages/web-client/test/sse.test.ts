import { describe, expect, it, vi } from "vitest";

import { newId } from "@town/contracts";

import { TownApiError, TownClient } from "../src/index.js";

function sseResponse(body: string, status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

function serverEvent(overrides: { kind?: string; sequence?: number } = {}) {
  return {
    id: newId<"session-event">(),
    sessionId: newId<"runtime-session">(),
    runId: newId<"session-run">(),
    sequence: overrides.sequence ?? 1,
    kind: overrides.kind ?? "run_started",
    payload: { trigger: "manual" },
    createdAt: "2026-08-06T00:00:00.000Z",
  };
}

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _event of stream) {
    void _event;
  }
}

describe("sessions.eventsStream", () => {
  it("yields server events in order and stops at the end frame", async () => {
    const first = serverEvent({ kind: "run_started", sequence: 1 });
    const second = serverEvent({
      kind: "assistant_output_recorded",
      sequence: 2,
    });
    const third = serverEvent({ kind: "tool_succeeded", sequence: 3 });
    const body = [
      ": heartbeat 2026-08-06T00:00:00.000Z",
      "",
      `id: 1\nevent: run_started\ndata: ${JSON.stringify(first)}`,
      "",
      `id: 2\nevent: assistant_output_recorded\ndata: ${JSON.stringify(second)}`,
      "",
      `id: 3\nevent: tool_succeeded\ndata: ${JSON.stringify(third)}`,
      "",
      "event: end\ndata: {}",
      "",
    ].join("\n");
    const fetchImpl = vi.fn(async () =>
      sseResponse(body),
    ) as unknown as typeof globalThis.fetch;
    const client = new TownClient({
      baseUrl: "https://api.example.test",
      token: "t",
      fetch: fetchImpl,
    });

    const events = [];
    for await (const event of client.sessions.eventsStream(first.sessionId)) {
      events.push(event);
    }

    expect(events).toHaveLength(3);
    expect(events[0]?.kind).toBe("run_started");
    expect(events[0]?.sequence).toBe(1);
    expect(events[1]?.kind).toBe("assistant_output_recorded");
    expect(events[2]?.sequence).toBe(3);
  });

  it("parses the data field and validates event payload fields", async () => {
    const event = serverEvent({ kind: "tool_call_proposed", sequence: 7 });
    const body = `event: tool_call_proposed\ndata: ${JSON.stringify(event)}\n\n`;
    const fetchImpl = vi.fn(async () =>
      sseResponse(body),
    ) as unknown as typeof globalThis.fetch;
    const client = new TownClient({
      baseUrl: "https://api.example.test",
      token: "t",
      fetch: fetchImpl,
    });

    const events = [];
    for await (const e of client.sessions.eventsStream(event.sessionId)) {
      events.push(e);
    }

    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe(event.id);
    expect(events[0]?.runId).toBe(event.runId);
    expect(events[0]?.payload).toEqual({ trigger: "manual" });
  });

  it("throws TownApiError when the stream emits an error frame", async () => {
    const body =
      'event: error\ndata: {"code":"EVENT_STREAM_FAILED","detail":"boom"}\n\n';
    const fetchImpl = vi.fn(async () =>
      sseResponse(body),
    ) as unknown as typeof globalThis.fetch;
    const client = new TownClient({
      baseUrl: "https://api.example.test",
      token: "t",
      fetch: fetchImpl,
    });

    await expect(
      drain(client.sessions.eventsStream(newId<"runtime-session">())),
    ).rejects.toBeInstanceOf(TownApiError);
    await expect(
      drain(client.sessions.eventsStream(newId<"runtime-session">())),
    ).rejects.toMatchObject({
      name: "TownApiError",
      code: "EVENT_STREAM_FAILED",
    });
  });

  it("throws TownApiError on a non-2xx stream response", async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse('{"error":"SESSION_NOT_FOUND"}', 404),
    ) as unknown as typeof globalThis.fetch;
    const client = new TownClient({
      baseUrl: "https://api.example.test",
      token: "t",
      fetch: fetchImpl,
    });

    await expect(
      drain(client.sessions.eventsStream(newId<"runtime-session">())),
    ).rejects.toMatchObject({ name: "TownApiError", status: 404 });
  });
});
