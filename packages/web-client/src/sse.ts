import { serverEventSchema, type ServerEvent } from "@town/contracts";

import { TownApiError } from "./errors.js";

type FrameResult =
  | { readonly kind: "event"; readonly event: ServerEvent }
  | { readonly kind: "end" }
  | { readonly kind: "error"; readonly error: TownApiError }
  | { readonly kind: "skip" };

/** Parse a single `text/event-stream` frame (block terminated by `\n\n`). */
function parseFrame(frame: string): FrameResult {
  let eventType = "";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue; // comment / heartbeat
    if (line.startsWith("event:")) {
      eventType = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      // Per the SSE spec, strip a single leading space after the colon.
      const value = line.slice("data:".length);
      dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
    }
  }

  if (eventType === "end") return { kind: "end" };
  if (eventType === "error") {
    let code: string | null = null;
    let detail = "Event stream failed.";
    if (dataLines.length > 0) {
      try {
        const parsed = JSON.parse(dataLines.join("\n")) as {
          code?: unknown;
          detail?: unknown;
        };
        if (typeof parsed.code === "string") code = parsed.code;
        if (typeof parsed.detail === "string") detail = parsed.detail;
      } catch {
        // Keep the default detail for a malformed error frame.
      }
    }
    return { kind: "error", error: new TownApiError(0, code, detail) };
  }

  if (dataLines.length === 0) return { kind: "skip" };

  let json: unknown;
  try {
    json = JSON.parse(dataLines.join("\n"));
  } catch {
    return { kind: "skip" };
  }
  const parsed = serverEventSchema.safeParse(json);
  if (!parsed.success) return { kind: "skip" };
  return { kind: "event", event: parsed.data };
}

/**
 * Iterate a `text/event-stream` response body, yielding validated
 * `ServerEvent` payloads. The `end` frame stops iteration; an `error` frame
 * throws a `TownApiError`. Heartbeat comments are ignored. If `signal` aborts,
 * the reader is released and iteration stops.
 */
export async function* parseEventStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<ServerEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted === true) break;
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let separator = buffer.indexOf("\n\n");
      while (separator !== -1) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        separator = buffer.indexOf("\n\n");
        const result = parseFrame(frame);
        if (result.kind === "end") return;
        if (result.kind === "error") throw result.error;
        if (result.kind === "event") yield result.event;
      }
    }
    // Flush a trailing frame not followed by a blank line.
    if (buffer.trim() !== "") {
      const result = parseFrame(buffer);
      if (result.kind === "end") return;
      if (result.kind === "error") throw result.error;
      if (result.kind === "event") yield result.event;
    }
  } finally {
    reader.releaseLock();
  }
}
