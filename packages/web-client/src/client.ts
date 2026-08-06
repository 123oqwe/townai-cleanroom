import type { Id, ServerEvent } from "@town/contracts";

import { TownApiError } from "./errors.js";
import { parseEventStream } from "./sse.js";
import type {
  AuthSessionResponse,
  ListOptions,
  MessageInput,
  MessageSubmission,
  SafeUser,
  Thread,
  ThreadCreateInput,
  ThreadPage,
  TurnPage,
  ConflictResolveResult,
  KnowledgeConflict,
  KnowledgeRevision,
  KnowledgeSearchPage,
  Memory,
  MemoryCreateInput,
  MemoryUpdateInput,
  MemoryUpdateResult,
  Person,
  PersonCreateInput,
  PersonRelationship,
  PersonUpdateInput,
  PersonUpdateResult,
  Profile,
  ProfileContent,
  ProfileUpdateResult,
  RelationshipCreateInput,
  SearchOptions,
  WikiCreateInput,
  WikiDocument,
  WikiUpdateInput,
  WikiUpdateResult,
} from "./types.js";
import type {
  ContentCollection,
  ContentCollectionCreateInput,
  ContentCreateInput,
  ContentItem,
  ContentListOptions,
  ContentPage,
  ContentRevision,
  ContentShare,
  ContentShareCreateResult,
  ContentUpdateInput,
  ExternalTriggerInput,
  Routine,
  RoutineCreateInput,
  RoutineEmailIngestInput,
  RoutineEmailIngestResult,
  RoutineRun,
  RoutineRunDetail,
  RoutineShareCreateResult,
  RoutineShareInstallInput,
  RoutineTemplate,
  RoutineTemplateInstallInput,
  RoutineTrigger,
  RoutineTriggerCreateInput,
  RoutineTriggerUpdateInput,
  RoutineUpdateInput,
  RoutineVersionPage,
  RoutineWebhook,
  RoutineWebhookCreateResult,
} from "./types.js";
import type {
  AccountCredentialInput,
  AdminAgentHealth,
  AdminOverview,
  AdminReport,
  AdminTeam,
  AdminUser,
  Approval,
  ApprovalDecisionInput,
  ApprovalListOptions,
  ApprovalPage,
  AuditListOptions,
  AuditPage,
  BillingListOptions,
  BillingResponse,
  Channel,
  ChannelCreateInput,
  ConnectedAccount,
  DeliveryListOptions,
  DeliveryPage,
  McpBinding,
  McpBindingCreateInput,
  McpBindingListOptions,
  McpServer,
  McpServerCreateInput,
  OperationsSummary,
  ScheduleListOptions,
  ScheduleResult,
  Square,
  SquareAccountGrantInput,
  SquareAccountShare,
  SquareCreateInput,
  SquareMember,
  SquareMemberAddInput,
  SquareMemberUpdateInput,
  SquarePolicy,
  SquarePolicyUpdateInput,
  Suggestion,
  SuggestionListOptions,
  SuggestionPage,
  SuggestionUpdateInput,
  Task,
  TaskCreateInput,
  TaskListOptions,
  TaskPage,
  TaskUpdateInput,
  TimelineListOptions,
  TimelinePage,
  Tool,
  ToolCall,
  ToolPolicyEvaluateInput,
  ToolPolicyResult,
  VoiceSynthesizeInput,
} from "./types.js";

export interface TownClientOptions {
  baseUrl: string;
  token?: string;
  /** Inject `fetch` for tests; defaults to the global. */
  fetch?: typeof globalThis.fetch;
}

export interface StreamOptions {
  cursor?: string;
  intervalMs?: number;
  windowMs?: number;
  signal?: AbortSignal;
}

export interface AuthApi {
  createSession(email: string): Promise<AuthSessionResponse>;
  deleteSession(): Promise<void>;
}

export interface MeApi {
  get(): Promise<SafeUser>;
}

export interface ThreadsApi {
  list(options?: ListOptions): Promise<ThreadPage>;
  get(id: Id<"thread">): Promise<Thread>;
  create(input: ThreadCreateInput): Promise<Thread>;
  turns(id: Id<"thread">, options?: ListOptions): Promise<TurnPage>;
}

export interface SessionsApi {
  create(
    threadId: Id<"thread">,
    input: MessageInput,
  ): Promise<MessageSubmission>;
  eventsStream(
    sessionId: Id<"runtime-session">,
    options?: StreamOptions,
  ): AsyncIterable<ServerEvent>;
}

export interface ProfileApi {
  get(): Promise<Profile>;
  create(content: ProfileContent): Promise<Profile>;
  update(
    content: ProfileContent,
    expectedRevision: number,
  ): Promise<ProfileUpdateResult>;
  history(): Promise<KnowledgeRevision[]>;
}

export interface MemoriesApi {
  list(): Promise<Memory[]>;
  get(id: Id<"memory">): Promise<Memory>;
  create(input: MemoryCreateInput): Promise<Memory>;
  update(
    id: Id<"memory">,
    input: MemoryUpdateInput,
  ): Promise<MemoryUpdateResult>;
  delete(id: Id<"memory">, expectedRevision: number): Promise<Memory>;
}

export interface PeopleApi {
  list(): Promise<Person[]>;
  get(id: Id<"person">): Promise<Person>;
  create(input: PersonCreateInput): Promise<Person>;
  update(
    id: Id<"person">,
    input: PersonUpdateInput,
  ): Promise<PersonUpdateResult>;
  relationships(
    personId: Id<"person">,
    options?: { includeRetired?: boolean },
  ): Promise<PersonRelationship[]>;
  addRelationship(
    personId: Id<"person">,
    input: RelationshipCreateInput,
  ): Promise<PersonRelationship>;
  deleteRelationship(
    relationshipId: Id<"person-relationship">,
    expectedRevision: number,
  ): Promise<void>;
}

export interface WikiApi {
  list(): Promise<WikiDocument[]>;
  get(id: Id<"wiki">): Promise<WikiDocument>;
  create(input: WikiCreateInput): Promise<WikiDocument>;
  update(id: Id<"wiki">, input: WikiUpdateInput): Promise<WikiUpdateResult>;
  history(id: Id<"wiki">): Promise<KnowledgeRevision[]>;
}

export interface SearchApi {
  search(query: string, options?: SearchOptions): Promise<KnowledgeSearchPage>;
}

export interface ConflictsApi {
  list(): Promise<KnowledgeConflict[]>;
  resolve(
    id: Id<"knowledge-conflict">,
    expectedRevision: number,
    resolution: "accept" | "reject",
  ): Promise<ConflictResolveResult>;
}

export interface KnowledgeApi {
  readonly profile: ProfileApi;
  readonly memories: MemoriesApi;
  readonly people: PeopleApi;
  readonly wiki: WikiApi;
  readonly search: SearchApi;
  readonly conflicts: ConflictsApi;
}

export interface RoutineTriggersApi {
  list(routineId: Id<"routine-schedule">): Promise<RoutineTrigger[]>;
  create(
    routineId: Id<"routine-schedule">,
    input: RoutineTriggerCreateInput,
  ): Promise<RoutineTrigger>;
  update(
    triggerId: Id<"routine-trigger">,
    input: RoutineTriggerUpdateInput,
  ): Promise<RoutineTrigger>;
  delete(
    triggerId: Id<"routine-trigger">,
    expectedRevision: number,
  ): Promise<void>;
}

export interface RoutineRunsApi {
  list(
    routineId: Id<"routine-schedule">,
    limit?: number,
  ): Promise<RoutineRun[]>;
  get(runId: Id<"integration-sync-run">): Promise<RoutineRunDetail>;
  replay(runId: Id<"integration-sync-run">): Promise<RoutineRun>;
}

export interface RoutineWebhooksApi {
  get(routineId: Id<"routine-schedule">): Promise<RoutineWebhook>;
  create(
    routineId: Id<"routine-schedule">,
  ): Promise<RoutineWebhookCreateResult>;
  setEnabled(
    routineId: Id<"routine-schedule">,
    enabled: boolean,
  ): Promise<RoutineWebhook>;
}

export interface RoutineTemplatesApi {
  list(): Promise<RoutineTemplate[]>;
  install(
    templateId: string,
    input: RoutineTemplateInstallInput,
  ): Promise<Routine>;
}

export interface RoutineSharesApi {
  create(
    routineId: Id<"routine-schedule">,
    expiresAt?: string | null,
  ): Promise<RoutineShareCreateResult>;
  delete(shareId: Id<"routine-share">): Promise<void>;
}

export interface RoutinesApi {
  list(): Promise<Routine[]>;
  get(id: Id<"routine-schedule">): Promise<Routine>;
  create(input: RoutineCreateInput): Promise<Routine>;
  update(
    id: Id<"routine-schedule">,
    input: RoutineUpdateInput,
  ): Promise<Routine>;
  delete(id: Id<"routine-schedule">, expectedRevision: number): Promise<void>;
  run(id: Id<"routine-schedule">, input: string): Promise<{ run: RoutineRun }>;
  trigger(
    id: Id<"routine-schedule">,
    input: ExternalTriggerInput,
  ): Promise<{ run: RoutineRun }>;
  ingestEmail(
    id: Id<"routine-schedule">,
    input: RoutineEmailIngestInput,
  ): Promise<RoutineEmailIngestResult>;
  versions(
    id: Id<"routine-schedule">,
    limit?: number,
  ): Promise<RoutineVersionPage>;
  readonly triggers: RoutineTriggersApi;
  readonly runs: RoutineRunsApi;
  readonly webhooks: RoutineWebhooksApi;
  readonly templates: RoutineTemplatesApi;
  readonly shares: RoutineSharesApi;
  installShared(input: RoutineShareInstallInput): Promise<Routine>;
}

export interface ContentCollectionsApi {
  list(): Promise<ContentCollection[]>;
  get(id: Id<"content-collection">): Promise<ContentItem[]>;
  create(input: ContentCollectionCreateInput): Promise<ContentCollection>;
  addItem(
    collectionId: Id<"content-collection">,
    contentId: Id<"content">,
  ): Promise<void>;
}

export interface ContentSharesApi {
  create(
    contentId: Id<"content">,
    expiresAt?: string | null,
  ): Promise<ContentShareCreateResult>;
  delete(shareId: Id<"content-share">): Promise<void>;
}

export interface ContentApi {
  list(options?: ContentListOptions): Promise<ContentPage>;
  get(id: Id<"content">): Promise<ContentItem>;
  create(input: ContentCreateInput): Promise<ContentItem>;
  update(id: Id<"content">, input: ContentUpdateInput): Promise<ContentItem>;
  archive(id: Id<"content">): Promise<ContentItem>;
  history(id: Id<"content">): Promise<ContentRevision[]>;
  blob(id: Id<"content">): Promise<Blob>;
  uploadBlob(
    id: Id<"content">,
    body: Uint8Array,
    contentType?: string,
  ): Promise<ContentItem>;
  readonly collections: ContentCollectionsApi;
  readonly shares: ContentSharesApi;
}

// ── Tasks API ──

export interface TasksApi {
  list(options?: TaskListOptions): Promise<TaskPage>;
  get(id: Id<"task">): Promise<Task>;
  create(input: TaskCreateInput): Promise<Task>;
  update(id: Id<"task">, input: TaskUpdateInput): Promise<Task>;
  delete(id: Id<"task">, expectedRevision: number): Promise<void>;
  markRead(id: Id<"task">): Promise<void>;
}

// ── Suggestions API ──

export interface SuggestionsApi {
  list(options?: SuggestionListOptions): Promise<SuggestionPage>;
  refresh(): Promise<void>;
  update(
    id: Id<"suggestion">,
    input: SuggestionUpdateInput,
  ): Promise<Suggestion>;
}

// ── Approvals API ──

export interface ApprovalsApi {
  list(options?: ApprovalListOptions): Promise<ApprovalPage>;
  get(id: Id<"approval">): Promise<Approval>;
  decide(id: Id<"approval">, input: ApprovalDecisionInput): Promise<Approval>;
}

// ── Tools API ──

export interface ToolsApi {
  list(): Promise<Tool[]>;
  policy: {
    evaluate(input: ToolPolicyEvaluateInput): Promise<ToolPolicyResult>;
  };
  calls: {
    get(id: Id<"tool-call">): Promise<ToolCall>;
  };
}

// ── MCP API ──

export interface McpApi {
  servers: {
    list(): Promise<McpServer[]>;
    create(input: McpServerCreateInput): Promise<McpServer>;
    delete(id: Id<"mcp-server">, expectedRevision: number): Promise<void>;
  };
  bindings: {
    list(options?: McpBindingListOptions): Promise<McpBinding[]>;
    create(
      serverId: Id<"mcp-server">,
      input: McpBindingCreateInput,
    ): Promise<McpBinding>;
    delete(id: Id<"mcp-binding">, expectedRevision: number): Promise<void>;
  };
}

// ── Channels API ──

export interface ChannelsApi {
  list(): Promise<Channel[]>;
  create(input: ChannelCreateInput): Promise<Channel>;
  delete(id: Id<"channel">): Promise<void>;
  deliveries: {
    list(options?: DeliveryListOptions): Promise<DeliveryPage>;
    replay(id: Id<"notification-delivery">): Promise<void>;
  };
  timeline(options?: TimelineListOptions): Promise<TimelinePage>;
}

// ── Accounts API ──

export interface AccountsApi {
  list(): Promise<ConnectedAccount[]>;
  updateCredential(
    id: Id<"connected-account">,
    input: AccountCredentialInput,
  ): Promise<ConnectedAccount>;
  refresh(id: Id<"connected-account">): Promise<ConnectedAccount>;
  delete(id: Id<"connected-account">): Promise<void>;
  google: {
    oauth: {
      start(): Promise<string>;
    };
  };
}

// ── Voice API ──

export interface VoiceApi {
  synthesize(input: VoiceSynthesizeInput): Promise<Blob>;
}

// ── Billing API ──

export interface BillingApi {
  status(options?: BillingListOptions): Promise<BillingResponse>;
}

// ── Squares API ──

export interface SquaresApi {
  list(): Promise<Square[]>;
  get(id: Id<"square">): Promise<Square>;
  create(input: SquareCreateInput): Promise<Square>;
  members: {
    list(id: Id<"square">): Promise<SquareMember[]>;
    add(id: Id<"square">, input: SquareMemberAddInput): Promise<SquareMember>;
    update(
      id: Id<"square">,
      userId: Id<"user">,
      input: SquareMemberUpdateInput,
    ): Promise<SquareMember>;
  };
  policy: {
    get(id: Id<"square">): Promise<SquarePolicy>;
    update(
      id: Id<"square">,
      input: SquarePolicyUpdateInput,
    ): Promise<SquarePolicy>;
  };
  accounts: {
    list(id: Id<"square">): Promise<SquareAccountShare[]>;
    add(
      id: Id<"square">,
      input: SquareAccountGrantInput,
    ): Promise<SquareAccountShare>;
    delete(shareId: Id<"square-account-share">): Promise<void>;
  };
}

// ── Operations API ──

export interface OperationsApi {
  audit: {
    list(options?: AuditListOptions): Promise<AuditPage>;
  };
  summary(): Promise<OperationsSummary>;
  schedule(options?: ScheduleListOptions): Promise<ScheduleResult>;
}

// ── Admin API ──

export interface AdminApi {
  overview(): Promise<AdminOverview>;
  reports(slug: string): Promise<AdminReport>;
  agentHealth(userId: Id<"user">): Promise<AdminAgentHealth>;
  users(userId: Id<"user">): Promise<AdminUser>;
  teams(squareId: Id<"square">): Promise<AdminTeam>;
}

interface RequestOptions {
  readonly method: string;
  readonly body?: unknown;
  readonly accept?: string;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
  readonly idempotencyKey?: string;
}

/**
 * Typed client for the Town `/v1` REST + SSE API. Construct with the API base
 * URL and an optional bearer token; every method returns a typed promise and
 * throws `TownApiError` (carrying `status`/`code`) on non-2xx responses.
 */
export class TownClient {
  readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof globalThis.fetch;
  readonly auth: AuthApi;
  readonly me: MeApi;
  readonly threads: ThreadsApi;
  readonly sessions: SessionsApi;
  readonly knowledge: KnowledgeApi;
  readonly routines: RoutinesApi;
  readonly content: ContentApi;
  readonly tasks: TasksApi;
  readonly suggestions: SuggestionsApi;
  readonly approvals: ApprovalsApi;
  readonly tools: ToolsApi;
  readonly mcp: McpApi;
  readonly channels: ChannelsApi;
  readonly accounts: AccountsApi;
  readonly voice: VoiceApi;
  readonly billing: BillingApi;
  readonly squares: SquaresApi;
  readonly operations: OperationsApi;
  readonly admin: AdminApi;

  constructor(options: TownClientOptions) {
    if (options.baseUrl.length === 0)
      throw new TypeError("TownClient requires a baseUrl.");
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.auth = {
      createSession: (email: string) =>
        this.postJson<AuthSessionResponse>("/v1/auth/session", { email }),
      deleteSession: () => this.delete("/v1/me/session"),
    };
    this.me = {
      get: () => this.getJson<{ user: SafeUser }>("/v1/me").then((r) => r.user),
    };
    this.threads = {
      list: (options?: ListOptions) =>
        this.getJson<ThreadPage>(`/v1/threads${this.query(options)}`),
      get: (id: Id<"thread">) =>
        this.getJson<{ thread: Thread }>(`/v1/threads/${id}`).then(
          (r) => r.thread,
        ),
      create: (input: ThreadCreateInput) =>
        this.postJson<{ thread: Thread }>("/v1/threads", input).then(
          (r) => r.thread,
        ),
      turns: (id: Id<"thread">, options?: ListOptions) =>
        this.getJson<TurnPage>(`/v1/threads/${id}/turns${this.query(options)}`),
    };
    this.sessions = {
      create: (threadId: Id<"thread">, input: MessageInput) =>
        this.postJson<MessageSubmission>(
          `/v1/threads/${threadId}/messages`,
          { text: input.text, mentions: input.mentions ?? [] },
          { idempotencyKey: crypto.randomUUID() },
        ),
      eventsStream: (
        sessionId: Id<"runtime-session">,
        options?: StreamOptions,
      ) => this.eventStream(sessionId, options),
    };
    this.knowledge = {
      profile: {
        get: () =>
          this.getJson<{ profile: Profile }>("/v1/profile").then(
            (r) => r.profile,
          ),
        create: (content: ProfileContent) =>
          this.postJson<{ profile: Profile }>("/v1/profile", {
            content,
          }).then((r) => r.profile),
        update: (content: ProfileContent, expectedRevision: number) =>
          this.putJson<ProfileUpdateResult>("/v1/profile", {
            content,
            expectedRevision,
          }),
        history: () =>
          this.getJson<{ revisions: KnowledgeRevision[] }>(
            "/v1/profile/history",
          ).then((r) => r.revisions),
      },
      memories: {
        list: () =>
          this.getJson<{ memories: Memory[] }>("/v1/memories").then(
            (r) => r.memories,
          ),
        get: (id: Id<"memory">) =>
          this.getJson<{ memory: Memory }>(`/v1/memories/${id}`).then(
            (r) => r.memory,
          ),
        create: (input: MemoryCreateInput) =>
          this.postJson<{ memory: Memory }>("/v1/memories", input).then(
            (r) => r.memory,
          ),
        update: (id: Id<"memory">, input: MemoryUpdateInput) =>
          this.putJson<MemoryUpdateResult>(`/v1/memories/${id}`, input),
        delete: (id: Id<"memory">, expectedRevision: number) =>
          this.deleteJson<{ memory: Memory }>(
            `/v1/memories/${id}?expectedRevision=${expectedRevision}`,
          ).then((r) => r.memory),
      },
      people: {
        list: () =>
          this.getJson<{ people: Person[] }>("/v1/people").then(
            (r) => r.people,
          ),
        get: (id: Id<"person">) =>
          this.getJson<{ person: Person }>(`/v1/people/${id}`).then(
            (r) => r.person,
          ),
        create: (input: PersonCreateInput) =>
          this.postJson<{ person: Person }>("/v1/people", input).then(
            (r) => r.person,
          ),
        update: (id: Id<"person">, input: PersonUpdateInput) =>
          this.putJson<PersonUpdateResult>(`/v1/people/${id}`, input),
        relationships: (
          personId: Id<"person">,
          options?: { includeRetired?: boolean },
        ) =>
          this.getJson<{ relationships: PersonRelationship[] }>(
            `/v1/people/${personId}/relationships${this.flagQuery("includeRetired", options?.includeRetired)}`,
          ).then((r) => r.relationships),
        addRelationship: (
          personId: Id<"person">,
          input: RelationshipCreateInput,
        ) =>
          this.postJson<{ relationship: PersonRelationship }>(
            `/v1/people/${personId}/relationships`,
            input,
          ).then((r) => r.relationship),
        deleteRelationship: (
          relationshipId: Id<"person-relationship">,
          expectedRevision: number,
        ) =>
          this.delete(
            `/v1/people/relationships/${relationshipId}?expectedRevision=${expectedRevision}`,
          ),
      },
      wiki: {
        list: () =>
          this.getJson<{ documents: WikiDocument[] }>("/v1/wiki").then(
            (r) => r.documents,
          ),
        get: (id: Id<"wiki">) =>
          this.getJson<{ document: WikiDocument }>(`/v1/wiki/${id}`).then(
            (r) => r.document,
          ),
        create: (input: WikiCreateInput) =>
          this.postJson<{ document: WikiDocument }>("/v1/wiki", input).then(
            (r) => r.document,
          ),
        update: (id: Id<"wiki">, input: WikiUpdateInput) =>
          this.putJson<WikiUpdateResult>(`/v1/wiki/${id}`, input),
        history: (id: Id<"wiki">) =>
          this.getJson<{ revisions: KnowledgeRevision[] }>(
            `/v1/wiki/${id}/revisions`,
          ).then((r) => r.revisions),
      },
      search: {
        search: (query: string, options?: SearchOptions) =>
          this.getJson<KnowledgeSearchPage>(
            `/v1/knowledge/search${this.searchQuery(query, options)}`,
          ),
      },
      conflicts: {
        list: () =>
          this.getJson<{ conflicts: KnowledgeConflict[] }>(
            "/v1/knowledge/conflicts",
          ).then((r) => r.conflicts),
        resolve: (
          id: Id<"knowledge-conflict">,
          expectedRevision: number,
          resolution: "accept" | "reject",
        ) =>
          this.postJson<ConflictResolveResult>(
            `/v1/knowledge/conflicts/${id}/resolve`,
            { expectedRevision, resolution },
          ),
      },
    };
    this.routines = {
      list: () =>
        this.getJson<{ routines: Routine[] }>("/v1/routines").then(
          (r) => r.routines,
        ),
      get: (id) =>
        this.getJson<{ routines: Routine[] }>("/v1/routines").then((r) => {
          const found = r.routines.find((item) => item.id === id);
          if (found === undefined)
            throw new TownApiError(
              404,
              "ROUTINE_NOT_FOUND",
              "Routine not found.",
            );
          return found;
        }),
      create: (input) =>
        this.postJson<{ routine: Routine }>("/v1/routines", input).then(
          (r) => r.routine,
        ),
      update: (id, input) =>
        this.patchJson<{ routine: Routine }>(`/v1/routines/${id}`, input).then(
          (r) => r.routine,
        ),
      delete: (id, expectedRevision) =>
        this.delete(`/v1/routines/${id}?expectedRevision=${expectedRevision}`),
      run: (id, input) =>
        this.postJson<{ run: RoutineRun }>(
          `/v1/routines/${id}/run`,
          { input },
          { idempotencyKey: crypto.randomUUID() },
        ),
      trigger: (id, input) =>
        this.postJson<{ run: RoutineRun }>(
          `/v1/routines/${id}/trigger`,
          input,
          { idempotencyKey: crypto.randomUUID() },
        ),
      ingestEmail: (id, input) =>
        this.postJson<RoutineEmailIngestResult>(
          `/v1/routines/${id}/ingest/email`,
          input,
        ),
      versions: (id, limit) =>
        this.getJson<RoutineVersionPage>(
          `/v1/routines/${id}/versions${limit !== undefined ? `?limit=${limit}` : ""}`,
        ),
      installShared: (input) =>
        this.postJson<{ routine: Routine }>("/v1/routines/install", input).then(
          (r) => r.routine,
        ),
      triggers: {
        list: (routineId) =>
          this.getJson<{ triggers: RoutineTrigger[] }>(
            `/v1/routines/${routineId}/triggers`,
          ).then((r) => r.triggers),
        create: (routineId, input) =>
          this.postJson<{ trigger: RoutineTrigger }>(
            `/v1/routines/${routineId}/triggers`,
            input,
          ).then((r) => r.trigger),
        update: (triggerId, input) =>
          this.patchJson<{ trigger: RoutineTrigger }>(
            `/v1/routine-triggers/${triggerId}`,
            input,
          ).then((r) => r.trigger),
        delete: (triggerId, expectedRevision) =>
          this.delete(
            `/v1/routine-triggers/${triggerId}?expectedRevision=${expectedRevision}`,
          ),
      },
      runs: {
        list: (routineId, limit) =>
          this.getJson<{ runs: RoutineRun[] }>(
            `/v1/routines/${routineId}/runs${limit !== undefined ? `?limit=${limit}` : ""}`,
          ).then((r) => r.runs),
        get: (runId) =>
          this.getJson<RoutineRunDetail>(`/v1/routine-runs/${runId}`),
        replay: (runId) =>
          this.postJson<{ run: RoutineRun }>(
            `/v1/routine-runs/${runId}/replay`,
            {},
            { idempotencyKey: crypto.randomUUID() },
          ).then((r) => r.run),
      },
      webhooks: {
        get: (routineId) =>
          this.getJson<{ webhook: RoutineWebhook }>(
            `/v1/routines/${routineId}/webhook`,
          ).then((r) => r.webhook),
        create: (routineId) =>
          this.postJson<RoutineWebhookCreateResult>(
            `/v1/routines/${routineId}/webhook`,
            {},
          ),
        setEnabled: (routineId, enabled) =>
          this.patchJson<{ webhook: RoutineWebhook }>(
            `/v1/routines/${routineId}/webhook`,
            { enabled },
          ).then((r) => r.webhook),
      },
      templates: {
        list: () =>
          this.getJson<{ templates: RoutineTemplate[] }>(
            "/v1/routine-templates",
          ).then((r) => r.templates),
        install: (templateId, input) =>
          this.postJson<{ routine: Routine }>(
            `/v1/routine-templates/${templateId}/install`,
            input,
          ).then((r) => r.routine),
      },
      shares: {
        create: (routineId, expiresAt) =>
          this.postJson<RoutineShareCreateResult>(
            `/v1/routines/${routineId}/shares`,
            expiresAt === undefined ? {} : { expiresAt },
          ),
        delete: (shareId) => this.delete(`/v1/routines/shares/${shareId}`),
      },
    };
    this.content = {
      list: (options) =>
        this.getJson<ContentPage>(`/v1/content${this.contentQuery(options)}`),
      get: (id) =>
        this.getJson<{ content: ContentItem }>(`/v1/content/${id}`).then(
          (r) => r.content,
        ),
      create: (input) =>
        this.postJson<{ content: ContentItem }>("/v1/content", input).then(
          (r) => r.content,
        ),
      update: (id, input) =>
        this.patchJson<{ content: ContentItem }>(
          `/v1/content/${id}`,
          input,
        ).then((r) => r.content),
      archive: (id) =>
        this.postJson<{ content: ContentItem }>(
          `/v1/content/${id}/archive`,
          {},
        ).then((r) => r.content),
      history: (id) =>
        this.getJson<{ revisions: ContentRevision[] }>(
          `/v1/content/${id}/revisions`,
        ).then((r) => r.revisions),
      blob: (id) => this.getBlob(`/v1/content/${id}/blob`),
      uploadBlob: (id, body, contentType) =>
        this.putRaw<{ content: ContentItem }>(
          `/v1/content/${id}/blob`,
          body,
          contentType,
        ).then((r) => r.content),
      collections: {
        list: () =>
          this.getJson<{ collections: ContentCollection[] }>(
            "/v1/content/collections",
          ).then((r) => r.collections),
        get: (collectionId) =>
          this.getJson<{ items: ContentItem[] }>(
            `/v1/content/collections/${collectionId}`,
          ).then((r) => r.items),
        create: (input) =>
          this.postJson<{ collection: ContentCollection }>(
            "/v1/content/collections",
            input,
          ).then((r) => r.collection),
        addItem: (collectionId, contentId) =>
          this.postJson(`/v1/content/collections/${collectionId}/items`, {
            contentId,
          }).then(() => undefined),
      },
      shares: {
        create: (contentId, expiresAt) =>
          this.postJson<{ share: { share: ContentShare; token: string } }>(
            `/v1/content/${contentId}/shares`,
            expiresAt === undefined ? {} : { expiresAt },
          ).then((r) => r.share),
        delete: (shareId) => this.delete(`/v1/content/shares/${shareId}`),
      },
    };
    this.tasks = {
      list: (options?: TaskListOptions) =>
        this.getJson<TaskPage>(`/v1/tasks${this.taskQuery(options)}`),
      get: (id: Id<"task">) =>
        this.getJson<{ task: Task }>(`/v1/tasks/${id}`).then((r) => r.task),
      create: (input: TaskCreateInput) =>
        this.postJson<{ task: Task }>("/v1/tasks", input).then((r) => r.task),
      update: (id: Id<"task">, input: TaskUpdateInput) =>
        this.patchJson<{ task: Task }>(`/v1/tasks/${id}`, input).then(
          (r) => r.task,
        ),
      delete: (id: Id<"task">, expectedRevision: number) =>
        this.delete(`/v1/tasks/${id}?expectedRevision=${expectedRevision}`),
      markRead: (id: Id<"task">) =>
        this.postVoid(`/v1/tasks/${id}/mark-read`, {}),
    };
    this.suggestions = {
      list: (options?: SuggestionListOptions) =>
        this.getJson<SuggestionPage>(
          `/v1/suggestions${this.suggestionQuery(options)}`,
        ),
      refresh: () => this.postVoid("/v1/suggestions/refresh", {}),
      update: (id: Id<"suggestion">, input: SuggestionUpdateInput) =>
        this.patchJson<{ suggestion: Suggestion }>(
          `/v1/suggestions/${id}`,
          input,
        ).then((r) => r.suggestion),
    };
    this.approvals = {
      list: (options?: ApprovalListOptions) =>
        this.getJson<ApprovalPage>(`/v1/approvals${this.query(options)}`),
      get: (id: Id<"approval">) =>
        this.getJson<{ approval: Approval }>(`/v1/approvals/${id}`).then(
          (r) => r.approval,
        ),
      decide: (id: Id<"approval">, input: ApprovalDecisionInput) =>
        this.postJson<{ approval: Approval }>(
          `/v1/approvals/${id}/decision`,
          input,
        ).then((r) => r.approval),
    };
    this.tools = {
      list: () =>
        this.getJson<{ tools: Tool[] }>("/v1/tools").then((r) => r.tools),
      policy: {
        evaluate: (input: ToolPolicyEvaluateInput) =>
          this.postJson<ToolPolicyResult>("/v1/tools/policy/evaluate", input),
      },
      calls: {
        get: (id: Id<"tool-call">) =>
          this.getJson<{ toolCall: ToolCall }>(`/v1/tool-calls/${id}`).then(
            (r) => r.toolCall,
          ),
      },
    };
    this.mcp = {
      servers: {
        list: () =>
          this.getJson<{ servers: McpServer[] }>("/v1/mcp-servers").then(
            (r) => r.servers,
          ),
        create: (input: McpServerCreateInput) =>
          this.postJson<{ server: McpServer }>("/v1/mcp-servers", input).then(
            (r) => r.server,
          ),
        delete: (id: Id<"mcp-server">, expectedRevision: number) =>
          this.delete(
            `/v1/mcp-servers/${id}?expectedRevision=${expectedRevision}`,
          ),
      },
      bindings: {
        list: (options?: McpBindingListOptions) => {
          const qs =
            options?.agentVersionId !== undefined
              ? `?agentVersionId=${encodeURIComponent(options.agentVersionId)}`
              : "";
          return this.getJson<{ bindings: McpBinding[] }>(
            `/v1/mcp-servers/bindings${qs}`,
          ).then((r) => r.bindings);
        },
        create: (serverId: Id<"mcp-server">, input: McpBindingCreateInput) =>
          this.postJson<{ binding: McpBinding }>(
            `/v1/mcp-servers/${serverId}/bindings`,
            input,
          ).then((r) => r.binding),
        delete: (id: Id<"mcp-binding">, expectedRevision: number) =>
          this.delete(
            `/v1/mcp-server-bindings/${id}?expectedRevision=${expectedRevision}`,
          ),
      },
    };
    this.channels = {
      list: () =>
        this.getJson<{ channels: Channel[] }>("/v1/channels").then(
          (r) => r.channels,
        ),
      create: (input: ChannelCreateInput) =>
        this.postJson<{ channel: Channel }>("/v1/channels", input).then(
          (r) => r.channel,
        ),
      delete: (id: Id<"channel">) => this.delete(`/v1/channels/${id}`),
      deliveries: {
        list: (options?: DeliveryListOptions) =>
          this.getJson<DeliveryPage>(
            `/v1/notification-deliveries${this.deliveryQuery(options)}`,
          ),
        replay: (id: Id<"notification-delivery">) =>
          this.postVoid(
            `/v1/notification-deliveries/${id}/replay`,
            {},
            { idempotencyKey: `delivery-replay:${id}:${crypto.randomUUID()}` },
          ),
      },
      timeline: (options?: TimelineListOptions) =>
        this.getJson<TimelinePage>(
          `/v1/notification-timeline${this.query(options)}`,
        ),
    };
    this.accounts = {
      list: () =>
        this.getJson<{ accounts: ConnectedAccount[] }>("/v1/accounts").then(
          (r) => r.accounts,
        ),
      updateCredential: (
        id: Id<"connected-account">,
        input: AccountCredentialInput,
      ) =>
        this.patchJson<{ account: ConnectedAccount }>(
          `/v1/accounts/${id}/credential`,
          input,
        ).then((r) => r.account),
      refresh: (id: Id<"connected-account">) =>
        this.postJson<{ account: ConnectedAccount }>(
          `/v1/accounts/${id}/refresh`,
          {},
        ).then((r) => r.account),
      delete: (id: Id<"connected-account">) =>
        this.delete(`/v1/accounts/${id}`),
      google: {
        oauth: {
          start: () => this.getRedirectUrl("/v1/accounts/google/oauth/start"),
        },
      },
    };
    this.voice = {
      synthesize: (input: VoiceSynthesizeInput) =>
        this.postBlob("/v1/voice/synthesize", input),
    };
    this.billing = {
      status: (options?: BillingListOptions) => {
        const qs = this.billingQuery(options);
        return this.getJson<BillingResponse>(`/v1/billing${qs}`);
      },
    };
    this.squares = {
      list: () =>
        this.getJson<{ squares: Square[] }>("/v1/squares").then(
          (r) => r.squares,
        ),
      get: (id: Id<"square">) =>
        this.getJson<{ square: Square }>(`/v1/squares/${id}`).then(
          (r) => r.square,
        ),
      create: (input: SquareCreateInput) =>
        this.postJson<{ square: Square }>("/v1/squares", input).then(
          (r) => r.square,
        ),
      members: {
        list: (id: Id<"square">) =>
          this.getJson<{ members: SquareMember[] }>(
            `/v1/squares/${id}/members`,
          ).then((r) => r.members),
        add: (id: Id<"square">, input: SquareMemberAddInput) =>
          this.postJson<{ member: SquareMember }>(
            `/v1/squares/${id}/members`,
            input,
          ).then((r) => r.member),
        update: (
          id: Id<"square">,
          userId: Id<"user">,
          input: SquareMemberUpdateInput,
        ) =>
          this.patchJson<{ member: SquareMember }>(
            `/v1/squares/${id}/members/${userId}`,
            input,
          ).then((r) => r.member),
      },
      policy: {
        get: (id: Id<"square">) =>
          this.getJson<{ policy: SquarePolicy }>(
            `/v1/squares/${id}/policy`,
          ).then((r) => r.policy),
        update: (id: Id<"square">, input: SquarePolicyUpdateInput) =>
          this.patchJson<{ policy: SquarePolicy }>(
            `/v1/squares/${id}/policy`,
            input,
          ).then((r) => r.policy),
      },
      accounts: {
        list: (id: Id<"square">) =>
          this.getJson<{ accounts: SquareAccountShare[] }>(
            `/v1/squares/${id}/accounts`,
          ).then((r) => r.accounts),
        add: (id: Id<"square">, input: SquareAccountGrantInput) =>
          this.postJson<{ share: SquareAccountShare }>(
            `/v1/squares/${id}/accounts`,
            input,
          ).then((r) => r.share),
        delete: (shareId: Id<"square-account-share">) =>
          this.delete(`/v1/square-account-shares/${shareId}`),
      },
    };
    this.operations = {
      audit: {
        list: (options?: AuditListOptions) =>
          this.getJson<AuditPage>(
            `/v1/operations/audit${this.auditQuery(options)}`,
          ),
      },
      summary: () => this.getJson<OperationsSummary>("/v1/operations/summary"),
      schedule: (options?: ScheduleListOptions) => {
        const qs =
          options?.limit !== undefined ? `?limit=${options.limit}` : "";
        return this.getJson<ScheduleResult>(`/v1/schedule${qs}`);
      },
    };
    this.admin = {
      overview: () => this.getJson<AdminOverview>("/v1/admin/overview"),
      reports: (slug: string) =>
        this.getJson<AdminReport>(`/v1/admin/reports/${slug}`),
      agentHealth: (userId: Id<"user">) =>
        this.getJson<AdminAgentHealth>(`/v1/admin/agent-health/${userId}`),
      users: (userId: Id<"user">) =>
        this.getJson<AdminUser>(`/v1/admin/users/${userId}`),
      teams: (squareId: Id<"square">) =>
        this.getJson<AdminTeam>(`/v1/admin/teams/${squareId}`),
    };
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private query(options: ListOptions | undefined): string {
    if (options === undefined) return "";
    const params = new URLSearchParams();
    if (options.cursor !== undefined) params.set("cursor", options.cursor);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    const search = params.toString();
    return search === "" ? "" : `?${search}`;
  }

  private contentQuery(options: ContentListOptions | undefined): string {
    if (options === undefined) return "";
    const params = new URLSearchParams();
    if (options.status !== undefined) params.set("status", options.status);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.cursor !== undefined) params.set("cursor", options.cursor);
    const search = params.toString();
    return search === "" ? "" : `?${search}`;
  }

  private flagQuery(name: string, value: boolean | undefined): string {
    return value === true ? `?${name}=true` : "";
  }

  private taskQuery(options: TaskListOptions | undefined): string {
    if (options === undefined) return "";
    const params = new URLSearchParams();
    if (options.status !== undefined) params.set("status", options.status);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.cursor !== undefined) params.set("cursor", options.cursor);
    const search = params.toString();
    return search === "" ? "" : `?${search}`;
  }

  private suggestionQuery(options: SuggestionListOptions | undefined): string {
    if (options === undefined) return "";
    const params = new URLSearchParams();
    if (options.status !== undefined) params.set("status", options.status);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.cursor !== undefined) params.set("cursor", options.cursor);
    const search = params.toString();
    return search === "" ? "" : `?${search}`;
  }

  private auditQuery(options: AuditListOptions | undefined): string {
    if (options === undefined) return "";
    const params = new URLSearchParams();
    if (options.action !== undefined) params.set("action", options.action);
    if (options.outcome !== undefined) params.set("outcome", options.outcome);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.cursor !== undefined) params.set("cursor", options.cursor);
    const search = params.toString();
    return search === "" ? "" : `?${search}`;
  }

  private billingQuery(options: BillingListOptions | undefined): string {
    if (options === undefined) return "";
    const params = new URLSearchParams();
    if (options.start !== undefined) params.set("start", options.start);
    if (options.end !== undefined) params.set("end", options.end);
    const search = params.toString();
    return search === "" ? "" : `?${search}`;
  }

  private deliveryQuery(options: DeliveryListOptions | undefined): string {
    if (options === undefined) return "";
    const params = new URLSearchParams();
    if (options.status !== undefined) params.set("status", options.status);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.cursor !== undefined) params.set("cursor", options.cursor);
    const search = params.toString();
    return search === "" ? "" : `?${search}`;
  }

  private async postBlob(path: string, body: unknown): Promise<Blob> {
    const response = await this.request(path, {
      method: "POST",
      body,
      accept: "audio/mpeg",
    });
    if (!response.ok) throw await this.toError(response);
    return response.blob();
  }

  private searchQuery(
    query: string,
    options: SearchOptions | undefined,
  ): string {
    const params = new URLSearchParams({ q: query });
    if (options?.types !== undefined && options.types.length > 0)
      params.set("types", options.types.join(","));
    if (options?.memoryScope === "global") params.set("memoryScope", "global");
    if (options?.memoryScope === "routine") {
      params.set("memoryScope", "routine");
      if (options.routineId !== undefined)
        params.set("routineId", options.routineId);
    }
    if (options?.includeInactive === true)
      params.set("includeInactive", "true");
    if (options?.cursor !== undefined) params.set("cursor", options.cursor);
    if (options?.limit !== undefined)
      params.set("limit", String(options.limit));
    return `?${params.toString()}`;
  }

  private buildHeaders(init: RequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: init.accept ?? "application/json",
      ...(init.headers ?? {}),
    };
    if (this.token !== undefined)
      headers["Authorization"] = `Bearer ${this.token}`;
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (init.idempotencyKey !== undefined)
      headers["Idempotency-Key"] = init.idempotencyKey;
    return headers;
  }

  private async request(path: string, init: RequestOptions): Promise<Response> {
    const headers = this.buildHeaders(init);
    const response = await this.fetchImpl(this.url(path), {
      method: init.method,
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      ...(init.signal !== undefined ? { signal: init.signal } : {}),
    });
    return response;
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await this.request(path, { method: "GET" });
    return this.parseJson<T>(response);
  }

  private async postJson<T>(
    path: string,
    body: unknown,
    extra: { readonly idempotencyKey?: string } | undefined = undefined,
  ): Promise<T> {
    const response = await this.request(path, {
      method: "POST",
      body,
      ...(extra?.idempotencyKey !== undefined
        ? { idempotencyKey: extra.idempotencyKey }
        : {}),
    });
    return this.parseJson<T>(response);
  }

  private async postVoid(
    path: string,
    body: unknown,
    extra: { readonly idempotencyKey?: string } | undefined = undefined,
  ): Promise<void> {
    const response = await this.request(path, {
      method: "POST",
      body,
      ...(extra?.idempotencyKey !== undefined
        ? { idempotencyKey: extra.idempotencyKey }
        : {}),
    });
    if (!response.ok) throw await this.toError(response);
  }

  private async putJson<T>(path: string, body: unknown): Promise<T> {
    const response = await this.request(path, { method: "PUT", body });
    return this.parseJson<T>(response);
  }

  private async patchJson<T>(path: string, body: unknown): Promise<T> {
    const response = await this.request(path, { method: "PATCH", body });
    return this.parseJson<T>(response);
  }

  private async getBlob(path: string): Promise<Blob> {
    const response = await this.request(path, {
      method: "GET",
      accept: "*/*",
    });
    if (!response.ok) throw await this.toError(response);
    return response.blob();
  }

  private async getRedirectUrl(path: string): Promise<string> {
    const response = await this.fetchImpl(this.url(path), {
      method: "GET",
      headers: this.buildHeaders({ method: "GET" }),
      redirect: "manual",
    });
    const location = response.headers.get("location");
    if (location === null) throw await this.toError(response);
    return location;
  }

  private async putRaw<T>(
    path: string,
    body: Uint8Array,
    contentType?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (contentType !== undefined) headers["Content-Type"] = contentType;
    const response = await this.request(path, {
      method: "PUT",
      headers,
      body,
    });
    return this.parseJson<T>(response);
  }

  private async deleteJson<T>(path: string): Promise<T> {
    const response = await this.request(path, { method: "DELETE" });
    return this.parseJson<T>(response);
  }

  private async delete(path: string): Promise<void> {
    const response = await this.request(path, { method: "DELETE" });
    if (!response.ok) throw await this.toError(response);
  }

  private async parseJson<T>(response: Response): Promise<T> {
    if (!response.ok) throw await this.toError(response);
    return (await response.json()) as T;
  }

  private async toError(response: Response): Promise<TownApiError> {
    let code: string | null = null;
    let detail = `API returned ${response.status}`;
    let metadata: Record<string, string> | null = null;
    try {
      const body = (await response.json()) as unknown;
      if (typeof body === "object" && body !== null) {
        const obj = body as Record<string, unknown>;
        const codeValue = obj["code"];
        if (typeof codeValue === "string") code = codeValue;
        else {
          const errorValue = obj["error"];
          if (typeof errorValue === "string") code = errorValue;
        }
        const detailValue = obj["detail"];
        if (typeof detailValue === "string") detail = detailValue;
        const metadataValue = obj["metadata"];
        if (
          typeof metadataValue === "object" &&
          metadataValue !== null &&
          !Array.isArray(metadataValue)
        ) {
          metadata = metadataValue as Record<string, string>;
        }
      }
    } catch {
      // Non-JSON error body: keep the default detail.
    }
    return new TownApiError(response.status, code, detail, metadata);
  }

  private async *eventStream(
    sessionId: Id<"runtime-session">,
    options: StreamOptions | undefined,
  ): AsyncGenerator<ServerEvent> {
    const params = new URLSearchParams();
    if (options?.cursor !== undefined) params.set("cursor", options.cursor);
    if (options?.intervalMs !== undefined)
      params.set("intervalMs", String(options.intervalMs));
    if (options?.windowMs !== undefined)
      params.set("windowMs", String(options.windowMs));
    const search = params.toString();
    const path = `/v1/sessions/${sessionId}/events/stream${
      search === "" ? "" : `?${search}`
    }`;
    const response = await this.request(path, {
      method: "GET",
      accept: "text/event-stream",
      ...(options?.signal !== undefined ? { signal: options.signal } : {}),
    });
    if (!response.ok) throw await this.toError(response);
    if (response.body === null)
      throw new TownApiError(0, "NO_STREAM_BODY", "Event stream had no body.");
    yield* parseEventStream(response.body, options?.signal);
  }
}
