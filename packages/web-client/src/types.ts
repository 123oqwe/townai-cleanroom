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

// ── Routines domain ──

export type RoutineTriggerKind =
  | "manual"
  | "schedule"
  | "incoming_email"
  | "outgoing_email"
  | "email_to_assistant"
  | "calendar_start"
  | "calendar_end"
  | "calendar_rsvp"
  | "calendar_changed"
  | "voice_transcribed"
  | "slack_mention"
  | "webhook"
  | "telegram_message"
  | "whatsapp_message";

export type RoutineRunStatus =
  "queued" | "running" | "succeeded" | "failed" | "blocked";

export type RoutineTriggerType =
  | "schedule"
  | "manual"
  | "webhook"
  | "incoming_email"
  | "email_to_assistant"
  | "calendar"
  | "voice_transcribed"
  | "slack_mention"
  | "telegram_message"
  | "whatsapp_message";

/** A routine schedule, as returned by `GET /v1/routines`. */
export interface Routine {
  id: Id<"routine-schedule">;
  ownerId: Id<"user">;
  agentId: Id<"agent">;
  agentVersionId: Id<"agent-version">;
  name: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface RoutineCreateInput {
  agentId: Id<"agent">;
  agentVersionId: Id<"agent-version">;
  name: string;
  cron: string;
  timezone?: string;
  nextRunAt: string;
  enabled?: boolean;
}

export interface RoutineUpdateInput extends RoutineCreateInput {
  expectedRevision: number;
}

export interface RoutineVersion {
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
}

export interface RoutineVersionPage {
  items: RoutineVersion[];
  nextCursor: string | null;
}

export interface RoutineRun {
  id: Id<"integration-sync-run">;
  ownerId: Id<"user">;
  accountId: Id<"connected-account">;
  routineScheduleId: Id<"routine-schedule"> | null;
  provider: string;
  status: RoutineRunStatus;
  triggerType: RoutineTriggerType;
  triggerData: Record<string, unknown>;
  idempotencyKey: string | null;
  replayOfRunId: Id<"integration-sync-run"> | null;
  replayKey: string | null;
  cursor: Record<string, unknown>;
  errorCode: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  runtimeRunId: Id<"session-run"> | null;
  createdAt: string;
  updatedAt: string;
}

/** Detail returned by `GET /v1/routine-runs/:runId`. */
export interface RoutineRunDetail {
  run: RoutineRun;
  result: {
    status: string;
    subject: string | null;
    [key: string]: unknown;
  } | null;
}

export interface RoutineTrigger {
  id: Id<"routine-trigger">;
  ownerId: Id<"user">;
  routineScheduleId: Id<"routine-schedule">;
  kind: RoutineTriggerKind;
  config: Record<string, unknown>;
  enabled: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface RoutineTriggerCreateInput {
  kind: RoutineTriggerKind;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export interface RoutineTriggerUpdateInput {
  expectedRevision: number;
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface RoutineWebhook {
  id: Id<"routine-webhook">;
  ownerId: Id<"user">;
  routineScheduleId: Id<"routine-schedule">;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Result of creating a webhook; the secret is shown only once. */
export interface RoutineWebhookCreateResult {
  webhook: RoutineWebhook;
  secret: string;
}

export interface RoutineTemplate {
  id: string;
  name: string;
  summary: string;
  setupPrompt: string;
  defaultApprovalMode: ApprovalMode;
}

export interface RoutineTemplateInstallInput {
  name?: string;
  cron: string;
  timezone?: string;
  nextRunAt: string;
  enabled?: boolean;
}

export interface RoutineShareInstallInput {
  token: string;
  name?: string;
  nextRunAt: string;
  enabled?: boolean;
}

export interface RoutineShare {
  id: Id<"routine-share">;
  ownerId: Id<"user">;
  routineScheduleId: Id<"routine-schedule">;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** Result of creating a share; the token is shown only once. */
export interface RoutineShareCreateResult {
  share: RoutineShare;
  token: string;
}

export interface RoutineEmailIngestInput {
  accountId: Id<"connected-account">;
  query?: string;
  maxResults?: number;
}

export interface RoutineEmailIngestResult {
  query: string;
  runs: RoutineRun[];
  nextPageToken: string | null;
}

export interface ExternalTriggerInput {
  kind:
    | "incoming_email"
    | "calendar"
    | "voice_transcribed"
    | "slack_mention"
    | "webhook";
  data: Record<string, unknown>;
}

// ── Content domain ──

export type ContentKind =
  | "document"
  | "email_draft"
  | "spreadsheet"
  | "deck"
  | "file"
  | "image"
  | "video"
  | "audio"
  | "recording"
  | "briefing"
  | "link"
  | "session";

export type ContentStatus = "active" | "archived" | "deleted";

export interface ContentItem {
  id: Id<"content">;
  ownerId: Id<"user">;
  kind: ContentKind;
  title: string;
  mimeType: string | null;
  storageKey: string | null;
  body: string | null;
  metadata: Record<string, unknown>;
  sourceSessionId: Id<"runtime-session"> | null;
  status: ContentStatus;
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContentPage {
  items: ContentItem[];
  nextCursor: string | null;
}

export interface ContentListOptions {
  status?: ContentStatus;
  limit?: number;
  cursor?: string;
}

export interface ContentCreateInput {
  kind: ContentKind;
  title: string;
  mimeType?: string | null;
  storageKey?: string | null;
  body?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ContentUpdateInput {
  expectedRevision: number;
  title: string;
  mimeType: string | null;
  storageKey: string | null;
  body: string | null;
  metadata: Record<string, unknown>;
}

export interface ContentRevision {
  id: Id<"content-revision">;
  contentId: Id<"content">;
  revision: number;
  title: string;
  mimeType: string | null;
  storageKey: string | null;
  body: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ContentCollection {
  id: Id<"content-collection">;
  ownerId: Id<"user">;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentCollectionCreateInput {
  name: string;
  description?: string;
}

export interface ContentShare {
  id: Id<"content-share">;
  contentId: Id<"content">;
  expiresAt: string | null;
  createdAt: string;
}

/** Result of creating a content share; the token is shown only once. */
export interface ContentShareCreateResult {
  share: ContentShare;
  token: string;
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

// ── Tasks domain ──

export type TaskStatus = "open" | "completed" | "deleted";
export type TaskApprovalMode =
  "respect_tool_setting" | "require_approval" | "autonomous";

export interface Task {
  id: Id<"task">;
  ownerId: Id<"user">;
  agentId: Id<"agent">;
  title: string;
  description: string;
  status: TaskStatus;
  approvalMode: TaskApprovalMode;
  unread: boolean;
  scheduledFor: string | null;
  sourceThreads: Id<"thread">[];
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskPage {
  items: Task[];
  nextCursor: string | null;
}

export interface TaskListOptions {
  status?: TaskStatus;
  limit?: number;
  cursor?: string;
}

export interface TaskCreateInput {
  title: string;
  description?: string;
  approvalMode?: TaskApprovalMode;
  sourceThreads?: Id<"thread">[];
  scheduledFor?: string | null;
}

export interface TaskUpdateInput {
  expectedRevision: number;
  title: string;
  description: string;
  status: TaskStatus;
  scheduledFor: string | null;
}

// ── Suggestions domain ──

export type SuggestionStatus = "open" | "dismissed" | "converted";

export interface Suggestion {
  id: Id<"suggestion">;
  ownerId: Id<"user">;
  kind: string;
  sourceType: string;
  sourceRef: string;
  title: string;
  body: string;
  status: SuggestionStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface SuggestionPage {
  items: Suggestion[];
  nextCursor: string | null;
}

export interface SuggestionListOptions {
  status?: SuggestionStatus;
  limit?: number;
  cursor?: string;
}

export interface SuggestionUpdateInput {
  expectedRevision: number;
  status: SuggestionStatus;
}

// ── Approvals domain ──

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface Approval {
  id: Id<"approval">;
  ownerId: Id<"user">;
  toolCallId: Id<"tool-call">;
  status: ApprovalStatus;
  arguments: Record<string, unknown>;
  expiresAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalPage {
  items: Approval[];
  nextCursor: string | null;
}

export interface ApprovalListOptions {
  limit?: number;
  cursor?: string;
}

export interface ApprovalDecisionInput {
  expectedRevision: number;
  decision: "approve" | "reject";
  reason?: string;
}

// ── Tools domain ──

export interface Tool {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  sideEffect: boolean;
  dataSensitivity: string;
}

export interface ToolPolicyEvaluateInput {
  toolName: string;
  arguments: Record<string, unknown>;
  approvalMode?: string;
  agentVersionId?: string;
}

export interface ToolPolicyResult {
  decision: string;
  reason: string;
  approvalRequired: boolean;
}

export interface ToolCall {
  id: Id<"tool-call">;
  ownerId: Id<"user">;
  name: string;
  status: string;
  sideEffect: boolean;
  dataSensitivity: string;
  accountBinding: string | null;
  arguments: Record<string, unknown>;
  result: Record<string, unknown> | null;
  errorCode: string | null;
  createdAt: string;
  finishedAt: string | null;
}

// ── MCP domain ──

export type McpServerStatus = "active" | "disabled";
export type McpTransport = "stdio" | "sse" | "streamable_http";

export interface McpServer {
  id: Id<"mcp-server">;
  ownerId: Id<"user">;
  name: string;
  url: string;
  transport: McpTransport;
  authRef: string | null;
  status: McpServerStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface McpServerCreateInput {
  name: string;
  url: string;
  transport: McpTransport;
  authRef?: string | null;
}

export interface McpBinding {
  id: Id<"mcp-binding">;
  ownerId: Id<"user">;
  serverId: Id<"mcp-server">;
  agentVersionId: Id<"agent-version">;
  modeOverride: string | null;
  accountScope: string[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface McpBindingListOptions {
  agentVersionId?: string;
}

export interface McpBindingCreateInput {
  agentVersionId: Id<"agent-version">;
  modeOverride?: string;
  accountScope?: string[];
}

// ── Channels domain ──

export type ChannelKind =
  "email" | "sms" | "push" | "telegram" | "whatsapp" | "slack";
export type ChannelStatus = "active" | "disabled";

export interface Channel {
  id: Id<"channel">;
  ownerId: Id<"user">;
  kind: ChannelKind;
  address: string;
  config: Record<string, unknown>;
  status: ChannelStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelCreateInput {
  kind: ChannelKind;
  address: string;
  config?: Record<string, unknown>;
}

export type DeliveryStatus =
  "pending" | "sent" | "delivered" | "failed" | "cancelled";

export interface NotificationDelivery {
  id: Id<"notification-delivery">;
  ownerId: Id<"user">;
  channelId: Id<"channel">;
  eventType: string;
  status: DeliveryStatus;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryPage {
  items: NotificationDelivery[];
  nextCursor: string | null;
}

export interface DeliveryListOptions {
  status?: DeliveryStatus;
  limit?: number;
  cursor?: string;
}

export interface TimelineEntry {
  id: string;
  kind: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface TimelinePage {
  items: TimelineEntry[];
  nextCursor: string | null;
}

export interface TimelineListOptions {
  limit?: number;
  cursor?: string;
}

// ── Accounts domain ──

export interface ConnectedAccount {
  id: Id<"connected-account">;
  ownerId: Id<"user">;
  provider: string;
  email: string;
  capabilities: Record<string, boolean>;
  needsReauth: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AccountCredentialInput {
  accessToken: string;
  refreshToken?: string;
  scopes?: string[];
}

// ── Voice domain ──

export interface VoiceSynthesizeInput {
  text: string;
  voiceId?: string;
}

// ── Billing domain ──

export interface BillingState {
  planName: string;
  creditBand: string;
  isBlocked: boolean;
}

export interface BillingUsageItem {
  category: string;
  quantity: number;
  unit: string;
}

export interface BillingPeriod {
  start: string;
  end: string;
}

export interface BillingResponse {
  status: "configured" | "not_configured";
  billing?: BillingState;
  usage?: BillingUsageItem[];
  period?: BillingPeriod;
}

export interface BillingListOptions {
  start?: string;
  end?: string;
}

// ── Squares domain ──

export type SquareStatus = "active" | "archived";
export type SquareMemberRole = "owner" | "admin" | "member";
export type SquareMemberStatus = "active" | "invited" | "suspended";

export interface Square {
  id: Id<"square">;
  ownerId: Id<"user">;
  name: string;
  slug: string;
  description: string;
  status: SquareStatus;
  membership: {
    role: SquareMemberRole;
    status: SquareMemberStatus;
  };
  createdAt: string;
  updatedAt: string;
}

export interface SquareCreateInput {
  name: string;
  slug: string;
  description?: string;
  settings?: Record<string, unknown>;
}

export interface SquareMember {
  userId: Id<"user">;
  role: SquareMemberRole;
  status: SquareMemberStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SquareMemberAddInput {
  userId: Id<"user">;
  role: SquareMemberRole;
  status?: SquareMemberStatus;
}

export interface SquareMemberUpdateInput {
  role: SquareMemberRole;
  status: SquareMemberStatus;
}

export interface SquarePolicy {
  defaultMode: string;
  allowedDomains: string[];
  allowedToolNames: string[];
  settings: Record<string, unknown>;
  revision: number;
}

export interface SquarePolicyUpdateInput {
  expectedRevision: number;
  defaultMode: string;
  allowedDomains: string[];
  allowedToolNames: string[];
  settings?: Record<string, unknown>;
}

export interface SquareAccountShare {
  id: Id<"square-account-share">;
  provider: string;
  email: string;
  capabilities: string[];
}

export interface SquareAccountGrantInput {
  accountId: Id<"connected-account">;
  accountOwnerId: Id<"user">;
  capabilities: string[];
}

// ── Operations domain ──

export interface AuditEvent {
  id: string;
  ownerId: Id<"user">;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: string;
  createdAt: string;
}

export interface AuditPage {
  items: AuditEvent[];
  nextCursor: string | null;
}

export interface AuditListOptions {
  action?: string;
  outcome?: string;
  limit?: number;
  cursor?: string;
}

export interface OperationsSummary {
  summary: Record<string, number>;
}

export interface ScheduleItem {
  id: string;
  kind: string;
  title: string;
  startAt: string;
  endAt: string;
  calendarId: string;
}

export interface ScheduleResult {
  items: ScheduleItem[];
  calendars: Array<{ id: string; name: string }>;
  calendarErrors: string[];
}

export interface ScheduleListOptions {
  limit?: number;
}

// ── Admin domain ──

export interface AdminOverview {
  users: number;
  activeSessions: number;
  routines: number;
  squares: number;
}

export interface AdminReport {
  slug: string;
  data: Record<string, unknown>;
}

export interface AdminAgentHealth {
  userId: Id<"user">;
  status: string;
  lastActiveAt: string | null;
  details: Record<string, unknown>;
}

export interface AdminUser {
  id: Id<"user">;
  email: string;
  status: string;
  createdAt: string;
}

export interface AdminTeam {
  squareId: Id<"square">;
  members: Array<{
    userId: Id<"user">;
    role: SquareMemberRole;
    status: SquareMemberStatus;
  }>;
}
