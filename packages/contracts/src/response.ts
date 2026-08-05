import { z } from "zod";

import { idSchema } from "./id.js";

/**
 * Runtime session event kinds emitted over the
 * `/v1/sessions/:sessionId/events/stream` text/event-stream. Mirrors the
 * backend `sessionEventKindSchema` in `@town/runtime`; duplicated here so the
 * shared wire contract stays free of backend package dependencies.
 */
export const serverEventKindSchema = z.enum([
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
]);

export const serverEventSchema = z
  .object({
    id: idSchema,
    sessionId: idSchema,
    runId: idSchema,
    sequence: z.number().int().positive(),
    kind: serverEventKindSchema,
    payload: z.record(z.string(), z.unknown()),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type ServerEventKind = z.infer<typeof serverEventKindSchema>;

/**
 * Parsed `data` payload of a single server-sent event frame. Dates arrive as
 * ISO 8601 strings because the stream serializes events with `JSON.stringify`.
 */
export type ServerEvent = z.infer<typeof serverEventSchema>;
