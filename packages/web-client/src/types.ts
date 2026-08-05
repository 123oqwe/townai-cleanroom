import type { Id } from "@town/contracts";

/** Approval policy applied to a thread or tool run. */
export type ApprovalMode =
  "respect_tool_setting" | "require_approval" | "autonomous";

/** Conversation thread kind, as serialized by `/v1/threads`. */
export type ThreadKind = "assistant" | "task";
export type ThreadStatus = "active" | "archived";

/**
 * Wire shape of a conversation thread. The backend stores dates as `Date`;
 * over JSON they arrive as ISO 8601 strings, so these DTOs use `string`.
 */
export interface Thread {
  id: Id<"thread">;
  ownerId: Id<"user">;
  agentId: Id<"agent">;
  kind: ThreadKind;
  title: string;
  approvalMode: ApprovalMode;
  status: ThreadStatus;
  pinnedAt: string | null;
  revision: number;
  lastTurnSequence: number;
  readThroughSequence: number;
  unread: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadPage {
  items: Thread[];
  nextCursor: string | null;
}

export interface ThreadMention {
  id: Id<"thread-mention">;
  position: number;
  targetType: "agent" | "thread" | "task" | "routine" | "content";
  targetId: Id<"mention-target">;
  label: string;
  createdAt: string;
}

export interface ThreadTurn {
  id: Id<"thread-turn">;
  ownerId: Id<"user">;
  threadId: Id<"thread">;
  sequence: number;
  role: "user" | "assistant" | "system";
  text: string;
  sourceType: "user" | "runtime" | "channel";
  sourceRef: string | null;
  mentions: ThreadMention[];
  createdAt: string;
}

export interface TurnPage {
  items: ThreadTurn[];
  nextCursor: string | null;
}

export type SessionRunState =
  | "queued"
  | "running"
  | "waiting_approval"
  | "waiting_user_input"
  | "completed"
  | "failed"
  | "cancelled";

export interface SessionRun {
  id: Id<"session-run">;
  sessionId: Id<"runtime-session">;
  triggeringTurnId: Id<"thread-turn">;
  state: SessionRunState;
  attempt: number;
  waitReason: string | null;
  inputResponse: string | null;
  outcome: Record<string, unknown> | null;
  errorCode: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export type RuntimeSessionState =
  | "idle"
  | "running"
  | "waiting_approval"
  | "waiting_user_input"
  | "failed"
  | "cancelled";

export interface RuntimeSession {
  id: Id<"runtime-session">;
  ownerId: Id<"user">;
  threadId: Id<"thread">;
  agentId: Id<"agent">;
  state: RuntimeSessionState;
  revision: number;
  lastEventSequence: number;
  agentVersion: {
    id: Id<"agent-version">;
    agentId: Id<"agent">;
    version: number;
    snapshot: {
      displayName: string;
      instructions: string;
      defaultApprovalMode: ApprovalMode;
      callableRoutineIds: string[];
    };
    changeReason: string | null;
    createdBy: "user" | "system";
    createdAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

/** Response of `POST /v1/threads/:threadId/messages`. */
export interface MessageSubmission {
  session: RuntimeSession;
  run: SessionRun;
  turn: ThreadTurn;
  replayed: boolean;
}

export interface SafeUser {
  id: Id<"user">;
  email: string;
  firstName: string | null;
  lastName: string | null;
  timezone: string;
  status: "active" | "disabled";
}

export interface AuthSessionResponse {
  token: string;
  user: SafeUser;
  session: {
    id: Id<"auth-session">;
    expiresAt: string;
  };
}

/** Parsed server-sent event yielded by `sessions.eventsStream`. */
export type { ServerEvent } from "@town/contracts";

/** Input for submitting a turn to a thread. */
export interface MessageInput {
  text: string;
  mentions?: Array<{
    position: number;
    targetType: ThreadMention["targetType"];
    targetId: string;
    label: string;
  }>;
}

export interface ThreadCreateInput {
  title: string;
  approvalMode: ApprovalMode;
}

export interface ListOptions {
  cursor?: string;
  limit?: number;
}
