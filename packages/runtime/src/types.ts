import { z } from "zod";

import type { AgentVersion } from "@town/agents";
import type { Id } from "@town/contracts";

export const runtimeSessionStateSchema = z.enum([
  "idle",
  "running",
  "waiting_approval",
  "waiting_user_input",
  "failed",
  "cancelled",
]);

export const sessionRunStateSchema = z.enum([
  "queued",
  "running",
  "waiting_approval",
  "waiting_user_input",
  "completed",
  "failed",
  "cancelled",
]);

export const sessionEventKindSchema = z.enum([
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
]);

export const runtimePayloadSchema = z.record(z.string(), z.unknown());

export type RuntimeSessionState = z.infer<typeof runtimeSessionStateSchema>;
export type SessionRunState = z.infer<typeof sessionRunStateSchema>;
export type SessionEventKind = z.infer<typeof sessionEventKindSchema>;
export type RuntimePayload = z.infer<typeof runtimePayloadSchema>;

export interface RuntimeSession {
  id: Id<"runtime-session">;
  ownerId: Id<"user">;
  threadId: Id<"thread">;
  agentId: Id<"agent">;
  state: RuntimeSessionState;
  revision: number;
  lastEventSequence: number;
  agentVersion: AgentVersion;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionRun {
  id: Id<"session-run">;
  sessionId: Id<"runtime-session">;
  triggeringTurnId: Id<"thread-turn">;
  state: SessionRunState;
  attempt: number;
  waitReason: string | null;
  outcome: RuntimePayload | null;
  errorCode: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  updatedAt: Date;
}

export interface SessionRunPage {
  items: SessionRun[];
  nextCursor: string | null;
}

export interface SessionEvent {
  id: Id<"session-event">;
  sessionId: Id<"runtime-session">;
  runId: Id<"session-run">;
  sequence: number;
  kind: SessionEventKind;
  payload: RuntimePayload;
  createdAt: Date;
}

export interface SessionEventPage {
  items: SessionEvent[];
  nextCursor: string | null;
}
