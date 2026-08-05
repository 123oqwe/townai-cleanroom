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

// ── Knowledge domain ──

export type KnowledgeJsonValue =
  | null
  | boolean
  | number
  | string
  | KnowledgeJsonValue[]
  | { [key: string]: KnowledgeJsonValue };

export type ResourceType =
  "profile" | "memory" | "person" | "wiki" | "goal" | "project";

export type KnowledgeAuthorType = "user" | "assistant" | "system";

export interface KnowledgeCitation {
  id: Id<"knowledge-citation">;
  sourceType: "account" | "user" | "session" | "web" | "system";
  sourceRef: string;
  sourceLabel: string | null;
  accountId: Id<"connected-account"> | null;
  observedAt: string;
}

export interface KnowledgeRevision {
  id: Id<"knowledge-revision">;
  ownerId: Id<"user">;
  resourceType: ResourceType;
  resourceId: string;
  revision: number;
  baseRevision: number;
  authorType: KnowledgeAuthorType;
  snapshot: Record<string, KnowledgeJsonValue>;
  changeReason: string | null;
  createdAt: string;
  citations: KnowledgeCitation[];
}

export interface KnowledgeConflict {
  id: Id<"knowledge-conflict">;
  ownerId: Id<"user">;
  resourceType: ResourceType;
  resourceId: string;
  baseRevision: number;
  currentRevision: number;
  proposedAuthorType: "assistant" | "system";
  proposedSnapshot: Record<string, KnowledgeJsonValue>;
  status: "pending" | "resolved" | "rejected";
  createdAt: string;
  resolvedAt: string | null;
}

/** `PUT` update results carry either the applied entity or a conflict. */
export type ProfileUpdateResult =
  | { kind: "applied"; profile: Profile }
  | { kind: "conflict"; conflict: KnowledgeConflict };

export type MemoryUpdateResult =
  | { kind: "applied"; memory: Memory }
  | { kind: "conflict"; conflict: KnowledgeConflict };

export type PersonUpdateResult =
  | { kind: "applied"; person: Person }
  | { kind: "conflict"; conflict: KnowledgeConflict };

export type WikiUpdateResult =
  | { kind: "applied"; document: WikiDocument }
  | { kind: "conflict"; conflict: KnowledgeConflict };

export type ConflictResolveResult =
  | { kind: "resolved"; revision: KnowledgeRevision }
  | { kind: "rejected"; conflict: KnowledgeConflict };

// ── Profile ──

export type ProfileContent = Record<string, KnowledgeJsonValue>;

export interface Profile {
  id: Id<"profile">;
  ownerId: Id<"user">;
  content: ProfileContent;
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
}

// ── Memories ──

export type MemoryScope = "global" | "routine";
export type MemoryStatus = "active" | "stale" | "superseded" | "retired";

export interface Memory {
  id: Id<"memory">;
  ownerId: Id<"user">;
  scope: MemoryScope;
  routineId: Id<"routine"> | null;
  content: string;
  status: MemoryStatus;
  confidence: number | null;
  observedAt: string;
  expiresAt: string | null;
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
}

export type MemoryCreateInput =
  | {
      scope: "global";
      content: string;
      confidence?: number;
      expiresAt?: string;
    }
  | {
      scope: "routine";
      routineId: Id<"routine">;
      content: string;
      confidence?: number;
      expiresAt?: string;
    };

export type MemoryUpdateInput =
  | {
      scope: "global";
      content: string;
      status: MemoryStatus;
      confidence?: number;
      expiresAt?: string;
      expectedRevision: number;
    }
  | {
      scope: "routine";
      routineId: Id<"routine">;
      content: string;
      status: MemoryStatus;
      confidence?: number;
      expiresAt?: string;
      expectedRevision: number;
    };

// ── People ──

export type PersonCategory =
  "uncategorized" | "coworker" | "family" | "personal";

export interface Person {
  id: Id<"person">;
  ownerId: Id<"user">;
  displayName: string;
  primaryEmail: string | null;
  category: PersonCategory;
  organization: string | null;
  role: string | null;
  notes: string;
  status: "active" | "retired";
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface PersonRelationship {
  id: Id<"person-relationship">;
  ownerId: Id<"user">;
  personId: Id<"person">;
  relatedPersonId: Id<"person">;
  relationshipType: string;
  notes: string;
  status: "active" | "retired";
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface PersonCreateInput {
  displayName: string;
  primaryEmail?: string;
  category: PersonCategory;
  organization?: string;
  role?: string;
  notes: string;
}

export interface PersonUpdateInput {
  displayName: string;
  primaryEmail?: string;
  category: PersonCategory;
  organization?: string;
  role?: string;
  notes: string;
  expectedRevision: number;
}

export interface RelationshipCreateInput {
  relatedPersonId: Id<"person">;
  relationshipType: string;
  notes?: string;
}

// ── Wiki ──

export type WikiKind = "profile" | "goal" | "project" | "page";

export interface WikiDocument {
  id: Id<"wiki">;
  ownerId: Id<"user">;
  kind: WikiKind;
  slug: string;
  title: string;
  body: string;
  status: "active" | "retired";
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface WikiCreateInput {
  kind: WikiKind;
  slug: string;
  title: string;
  body: string;
}

export interface WikiUpdateInput {
  kind: WikiKind;
  slug: string;
  title: string;
  body: string;
  expectedRevision: number;
}

// ── Search ──

export interface KnowledgeSearchResult {
  ownerId: Id<"user">;
  resourceType: ResourceType;
  resourceId: string;
  title: string | null;
  text: string;
  subtype: string | null;
  status: string;
  score: number;
  updatedAt: string;
}

export interface KnowledgeSearchPage {
  items: KnowledgeSearchResult[];
  nextCursor: string | null;
}

export interface SearchOptions {
  types?: ResourceType[];
  memoryScope?: "global" | "routine";
  routineId?: Id<"routine">;
  includeInactive?: boolean;
  cursor?: string;
  limit?: number;
}
