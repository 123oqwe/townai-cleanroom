import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { Sql } from "postgres";

import {
  AgentError,
  InputRequestError,
  TaskError,
  ThreadError,
  TurnError,
  type AgentRepository,
  type InputRequestRepository,
  type TaskRepository,
  type ThreadRepository,
  type TurnRepository,
} from "@town/agents";
import type {
  AccountRepository,
  IdentityService,
  GoogleTokenRefresher,
} from "@town/identity";
import { AccountError, GoogleTokenError, IdentityError } from "@town/identity";
import {
  KnowledgeSearchError,
  MemoryError,
  PeopleError,
  ProfileError,
  RevisionError,
  WikiError,
  type KnowledgeConflictService,
  type KnowledgeSearchRepository,
  type MemoryRepository,
  type PeopleRepository,
  type ProfileRepository,
  type RevisionRepository,
  type WikiRepository,
  type WikiUpkeepScanner,
  type GoalsProjectsRepository,
  type TrustedContactsRepository,
  type KnowledgeGraphRepository,
} from "@town/knowledge";
import {
  RuntimeError,
  type ApprovalDecisionRepository,
  type RuntimeTransitionService,
  type SessionRepository,
} from "@town/runtime";
import {
  ToolExecutionError,
  McpRepositoryError,
  ToolRegistryError,
  type ToolExecutionRepository,
  type ToolRegistryRepository,
} from "@town/tools";
import type { AppServer, AppServerRequest } from "@town/harness";
import { ContentError, type ContentRepository } from "@town/content";
import { ChannelError, type ChannelRepository } from "@town/channels";
import { BillingError, type BillingRepository } from "@town/billing";
import { OperationsError, type OperationsRepository } from "@town/operations";
import {
  SquareError,
  type SquareRepository,
  type SharedAccountRepository,
} from "@town/teams";

import { createAuthMiddleware, type AuthVariables } from "./lib/auth.js";
import {
  registerOidcLoginRoutes,
  OidcRouteError,
  type OidcLoginDependencies,
} from "./auth/oidc-login-routes.js";
import {
  registerSessionRoutes,
  type SessionRouteDependencies,
} from "./auth/session-routes.js";

import {
  SessionManagementError,
  VerifiedIdentityError,
  OidcAttemptError,
  getAuthErrorMessage,
  RedirectValidationError,
} from "@town/identity";
import {
  createRateLimiter,
  createRateLimitMiddleware,
  type AnyRateLimiter,
} from "./lib/rate-limit.js";
import {
  registerAgentRoutes,
  type AgentDependencies,
} from "./routes/agent-routes.js";
import {
  registerKnowledgeRoutes,
  type KnowledgeDependencies,
} from "./routes/knowledge-routes.js";
import {
  registerRuntimeRoutes,
  type RuntimeDependencies,
} from "./routes/runtime-routes.js";
import {
  registerToolRoutes,
  type ToolDependencies,
} from "./routes/tool-routes.js";
import { registerMcpRoutes } from "./routes/mcp-routes.js";
import type { McpRepository } from "@town/tools";
import {
  registerContentRoutes,
  type ContentStorage,
} from "./routes/content-routes.js";
import { registerSquareRoutes } from "./routes/square-routes.js";
import { registerSharedAccountRoutes } from "./routes/shared-account-routes.js";
import { registerChannelRoutes } from "./routes/channel-routes.js";
import { registerBillingRoutes } from "./routes/billing-routes.js";
import {
  registerOperationsRoutes,
  registerPublicAnalyticsRoutes,
} from "./routes/operations-routes.js";
import { registerAdminRoutes } from "./routes/admin/index.js";
import {
  registerRoutineRoutes,
  registerRoutineShareRoutes,
  registerRoutineWebhookRoutes,
} from "./routes/routine-routes.js";
import type {
  RoutineRepository,
  RoutineResultRepository,
} from "@town/routines";
import type { GoogleApiClient } from "@town/google";
import { RoutineError } from "@town/routines";
import { registerAccountRoutes } from "./routes/account-routes.js";
import {
  registerGoogleOAuthRoutes,
  type GoogleOAuthDependencies,
} from "./oauth/google-oauth-routes.js";
import {
  registerMicrosoftOAuthRoutes,
  type MicrosoftOAuthDependencies,
} from "./oauth/microsoft-oauth-routes.js";
import { registerSuggestionRoutes } from "./routes/suggestion-routes.js";
import { registerScheduleRoutes } from "./routes/schedule-routes.js";
import type { SuggestionRepository } from "@town/suggestions";
import { SuggestionError } from "@town/suggestions";
import { registerA2ARoutes } from "./routes/a2a-routes.js";
import { registerSlackEventsRoute } from "./webhooks/slack-events.js";
import { registerTelegramEventsRoute } from "./webhooks/telegram-events.js";
import {
  registerPipedreamRoutes,
  type PipedreamDependencies,
} from "./routes/pipedream-routes.js";
import { registerWhatsAppEventsRoute } from "./webhooks/whatsapp-events.js";
import { registerTwilioVoiceEventsRoute } from "./webhooks/twilio-voice-events.js";
import { registerVoiceRoutes } from "./lib/voice-routes.js";
import { registerVapiVoiceEventsRoute } from "./webhooks/vapi-voice-events.js";
import { registerGmailPubsubEventsRoute } from "./routes/gmail-pubsub-events.js";
import type { VoiceSynthesisProvider } from "./lib/elevenlabs-voice.js";
import type { A2ARepository } from "@town/a2a";
import { A2AError } from "@town/a2a";
import type { HarnessExecutionContext } from "./lib/harness-runtime-adapter.js";

export interface AppDependencies {
  rateLimiter?: AnyRateLimiter;
  sql?: Sql;
  identityService: IdentityService;
  accountRepository: AccountRepository;
  profileRepository?: ProfileRepository;
  memoryRepository?: MemoryRepository;
  peopleRepository?: PeopleRepository;
  wikiRepository?: WikiRepository;
  revisionRepository?: RevisionRepository;
  knowledgeSearchRepository?: KnowledgeSearchRepository;
  knowledgeConflictService?: KnowledgeConflictService;
  knowledgeUpkeepScanner?: WikiUpkeepScanner;
  goalsProjectsRepository?: GoalsProjectsRepository;
  trustedContactsRepository?: TrustedContactsRepository;
  knowledgeGraphRepository?: KnowledgeGraphRepository;
  agentRepository?: AgentRepository;
  threadRepository?: ThreadRepository;
  turnRepository?: TurnRepository;
  taskRepository?: TaskRepository;
  inputRequestRepository?: InputRequestRepository;
  sessionRepository?: SessionRepository;
  runtimeTransitionService?: RuntimeTransitionService;
  approvalDecisions?: ApprovalDecisionRepository;
  toolRegistryRepository?: ToolRegistryRepository;
  toolExecutionRepository?: ToolExecutionRepository;
  mcpRepository?: McpRepository;
  contentRepository?: ContentRepository;
  contentStorage?: ContentStorage;
  squareRepository?: SquareRepository;
  sharedAccountRepository?: SharedAccountRepository;
  channelRepository?: ChannelRepository;
  billingRepository?: BillingRepository;
  operationsRepository?: OperationsRepository;
  adminAllowlistEmails?: readonly string[];
  routineRepository?: RoutineRepository;
  routineResultRepository?: RoutineResultRepository;
  suggestionRepository?: SuggestionRepository;
  a2aRepository?: A2ARepository;
  googleOAuth?: GoogleOAuthDependencies;
  googleTokenRefresher?: GoogleTokenRefresher;
  oidcLogin?: OidcLoginDependencies;
  sessionRoutes?: SessionRouteDependencies;
  devEmailLoginEnabled?: boolean;
  googleApi?: GoogleApiClient;
  gmailPubsubClientId?: string;
  microsoftOAuth?: MicrosoftOAuthDependencies;
  pipedream?: PipedreamDependencies;
  e2bApiKey?: string;
  webOrigin?: string;
  workerEnabled?: boolean;
  workspaceTools?: boolean;
  codeRunner?: boolean;
  slackSigningSecret?: string;
  telegramSecretToken?: string;
  whatsappAppSecret?: string;
  whatsappVerifyToken?: string;
  twilioAuthToken?: string;
  voiceProvider?: VoiceSynthesisProvider;
  vapiWebhookSecret?: string;
  harnessServer?: AppServer;
  harnessServerFactory?: (
    ownerId: string,
    executionContext?: HarnessExecutionContext,
  ) => AppServer | Promise<AppServer>;
  harnessResponses?: boolean;
  harnessCodex?: boolean;
}

function runtimeDependencies(
  dependencies: AppDependencies,
): RuntimeDependencies | null {
  const { sessionRepository, runtimeTransitionService } = dependencies;
  if (
    sessionRepository === undefined ||
    runtimeTransitionService === undefined
  ) {
    return null;
  }
  return {
    sessionRepository,
    runtimeTransitionService,
    ...(dependencies.approvalDecisions === undefined
      ? {}
      : { approvalDecisions: dependencies.approvalDecisions }),
    ...(dependencies.billingRepository === undefined
      ? {}
      : { billingRepository: dependencies.billingRepository }),
  };
}

function toolDependencies(
  dependencies: AppDependencies,
): ToolDependencies | null {
  if (
    dependencies.toolRegistryRepository === undefined ||
    dependencies.toolExecutionRepository === undefined
  ) {
    return null;
  }
  return {
    registry: dependencies.toolRegistryRepository,
    execution: dependencies.toolExecutionRepository,
  };
}

function agentDependencies(
  dependencies: AppDependencies,
): AgentDependencies | null {
  const {
    agentRepository,
    threadRepository,
    turnRepository,
    taskRepository,
    inputRequestRepository,
  } = dependencies;
  if (
    agentRepository === undefined ||
    threadRepository === undefined ||
    turnRepository === undefined ||
    taskRepository === undefined ||
    inputRequestRepository === undefined
  ) {
    return null;
  }
  return {
    agentRepository,
    threadRepository,
    turnRepository,
    taskRepository,
    inputRequestRepository,
  };
}

function knowledgeDependencies(
  dependencies: AppDependencies,
): KnowledgeDependencies | null {
  const {
    profileRepository,
    memoryRepository,
    peopleRepository,
    wikiRepository,
    revisionRepository,
    knowledgeSearchRepository,
    knowledgeConflictService,
    knowledgeUpkeepScanner,
    goalsProjectsRepository,
    trustedContactsRepository,
    knowledgeGraphRepository,
  } = dependencies;
  if (
    profileRepository === undefined ||
    memoryRepository === undefined ||
    peopleRepository === undefined ||
    wikiRepository === undefined ||
    revisionRepository === undefined ||
    knowledgeSearchRepository === undefined ||
    knowledgeConflictService === undefined
  ) {
    return null;
  }
  return {
    profileRepository,
    memoryRepository,
    peopleRepository,
    wikiRepository,
    revisionRepository,
    knowledgeSearchRepository,
    knowledgeConflictService,
    ...(knowledgeUpkeepScanner === undefined ? {} : { knowledgeUpkeepScanner }),
    ...(goalsProjectsRepository === undefined
      ? {}
      : { goalsProjectsRepository }),
    ...(trustedContactsRepository === undefined
      ? {}
      : { trustedContactsRepository }),
    ...(knowledgeGraphRepository === undefined
      ? {}
      : { knowledgeGraphRepository }),
  };
}

export function createApp(dependencies?: AppDependencies) {
  if (
    dependencies?.harnessServer !== undefined &&
    dependencies.harnessServerFactory !== undefined
  )
    throw new Error(
      "HARNESS_CONFIGURATION_CONFLICT: provide harnessServer or harnessServerFactory, not both.",
    );
  const app = new Hono<{ Variables: AuthVariables }>();

  const rateLimiter =
    dependencies?.rateLimiter ??
    createRateLimiter({
      windowMs:
        Number(process.env["RATE_LIMIT_WINDOW_MS"]) > 0
          ? Number(process.env["RATE_LIMIT_WINDOW_MS"])
          : 60_000,
      max:
        Number(process.env["RATE_LIMIT_MAX"]) > 0
          ? Number(process.env["RATE_LIMIT_MAX"])
          : 60,
    });
  const rateLimit = createRateLimitMiddleware(rateLimiter);
  if (dependencies?.webOrigin !== undefined)
    app.use(
      "/v1/*",
      cors({
        origin: dependencies.webOrigin,
        allowHeaders: ["Authorization", "Content-Type"],
        allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        maxAge: 600,
      }),
    );

  app.onError((error, context) => {
    // Log unexpected errors so they are diagnosable. Known error types
    // below are handled with specific HTTP responses; anything that falls
    // through to the 500 response is logged at error level.
    if (!(
      error instanceof IdentityError ||
      error instanceof AccountError ||
      error instanceof KnowledgeSearchError ||
      error instanceof PeopleError ||
      error instanceof TaskError ||
      error instanceof TurnError ||
      error instanceof InputRequestError ||
      error instanceof RuntimeError ||
      error instanceof AgentError ||
      error instanceof ThreadError ||
      error instanceof RevisionError ||
      error instanceof WikiError ||
      error instanceof MemoryError ||
      error instanceof ProfileError ||
      error instanceof ToolRegistryError ||
      error instanceof ToolExecutionError ||
      error instanceof McpRepositoryError ||
      error instanceof GoogleTokenError ||
      error instanceof SuggestionError ||
      error instanceof ChannelError ||
      error instanceof OidcRouteError ||
      error instanceof OidcAttemptError ||
      error instanceof SessionManagementError ||
      error instanceof VerifiedIdentityError
    )) {
      console.error("[unhandled-error]", error);
    }
    if (error instanceof GoogleTokenError) {
      const status = error.code === "GOOGLE_TOKEN_NOT_CONFIGURED" ? 503 : 502;
      const safeMessage =
        error.code === "GOOGLE_TOKEN_NOT_CONFIGURED"
          ? "Google integration is not configured."
          : "Google token refresh failed.";
      return context.json(
        {
          type: "https://town.local/problems/google-token",
          title: "Google token refresh failed",
          status,
          detail: safeMessage,
          code: error.code,
        },
        status,
      );
    }
    // Unified auth error mapping: stable, explicit, no internal info leak.
    if (error instanceof OidcRouteError) {
      const status = error.status as 400 | 401 | 403 | 502 | 503;
      return context.json(
        {
          type: "https://town.local/problems/auth",
          title: "Authentication error",
          status,
          detail: getAuthErrorMessage(error.code),
          code: error.code,
        },
        status,
      );
    }
    if (error instanceof OidcAttemptError) {
      const status =
        error.code === "AUTH_FLOW_REPLAYED"
          ? 409
          : error.code === "AUTH_BROWSER_BINDING_INVALID"
            ? 400
            : 400;
      return context.json(
        {
          type: "https://town.local/problems/auth",
          title: "Auth flow error",
          status,
          detail: getAuthErrorMessage(error.code),
          code: error.code,
        },
        status,
      );
    }
    if (error instanceof VerifiedIdentityError) {
      const status = error.code === "AUTH_ACCOUNT_DISABLED" ? 403 : 409;
      return context.json(
        {
          type: "https://town.local/problems/auth",
          title: "Identity conflict",
          status,
          detail: getAuthErrorMessage(error.code),
          code: error.code,
        },
        status,
      );
    }
    if (error instanceof SessionManagementError) {
      const status =
        error.code === "SESSION_ROTATION_CONFLICT" ||
        error.code === "SESSION_AUTH_METHOD_INVALID"
          ? 409
          : error.code === "SESSION_NOT_FOUND"
            ? 404
            : 401;
      return context.json(
        {
          type: "https://town.local/problems/auth",
          title: "Session error",
          status,
          detail: getAuthErrorMessage(error.code),
          code: error.code,
        },
        status,
      );
    }
    if (error instanceof RedirectValidationError) {
      return context.json(
        {
          type: "https://town.local/problems/auth",
          title: "Invalid redirect",
          status: 400,
          detail: getAuthErrorMessage(error.code),
          code: error.code,
        },
        400,
      );
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return context.json(
        {
          type: "https://town.local/problems/invalid-request",
          title: "Invalid request",
          status: 400,
          detail: "The request does not match the required contract.",
          code: "INVALID_REQUEST",
        },
        400,
      );
    }
    if (error instanceof IdentityError) {
      const status = error.code === "ACCESS_DENIED" ? 403 : 401;
      return context.json(
        {
          type:
            status === 403
              ? "https://town.local/problems/forbidden"
              : "https://town.local/problems/unauthenticated",
          title: status === 403 ? "Forbidden" : "Authentication required",
          status,
          detail:
            status === 403
              ? "This identity is not allowed."
              : "The session is invalid.",
          code: error.code,
        },
        status,
      );
    }
    if (
      error instanceof ChannelError &&
      error.code === "INVALID_CHANNEL_CONFIG"
    ) {
      return context.json(
        {
          type: "https://town.local/problems/invalid-request",
          title: "Invalid channel configuration",
          status: 400,
          detail:
            "The channel configuration is not a permitted public metadata shape.",
          code: error.code,
        },
        400,
      );
    }
    if (error instanceof OperationsError) {
      const status =
        error.code === "AUDIT_CONFLICT"
          ? 409
          : error.code === "RATE_LIMITED"
            ? 429
            : 400;
      return context.json(
        {
          type: "https://town.local/problems/invalid-request",
          title: "Invalid operations request",
          status,
          detail: error.message,
          code: error.code,
        },
        status,
      );
    }
    if (error instanceof BillingError) {
      const status = error.code === "BILLING_NOT_CONFIGURED" ? 503 : 409;
      return context.json(
        {
          type: "https://town.local/problems/billing",
          title: "Billing request rejected",
          status,
          detail: error.message,
          code: error.code,
        },
        status,
      );
    }
    if (error instanceof SquareError && error.code === "FORBIDDEN") {
      return context.json(
        {
          type: "https://town.local/problems/forbidden",
          title: "Forbidden",
          status: 403,
          detail:
            "The authenticated user cannot perform this Square operation.",
          code: error.code,
        },
        403,
      );
    }
    if (error instanceof ChannelError && error.code === "FORBIDDEN") {
      return context.json(
        {
          type: "https://town.local/problems/forbidden",
          title: "Forbidden",
          status: 403,
          detail: "The authenticated user cannot manage this channel.",
          code: error.code,
        },
        403,
      );
    }
    if (
      (error instanceof ProfileError && error.code === "PROFILE_NOT_FOUND") ||
      (error instanceof MemoryError && error.code === "MEMORY_NOT_FOUND") ||
      (error instanceof PeopleError && error.code === "PERSON_NOT_FOUND") ||
      (error instanceof WikiError &&
        error.code === "WIKI_DOCUMENT_NOT_FOUND") ||
      (error instanceof RevisionError &&
        (error.code === "RESOURCE_NOT_FOUND" ||
          error.code === "CONFLICT_NOT_FOUND")) ||
      (error instanceof ContentError &&
        (error.code === "CONTENT_NOT_FOUND" ||
          error.code === "COLLECTION_NOT_FOUND" ||
          error.code === "SHARE_NOT_FOUND")) ||
      (error instanceof SquareError &&
        (error.code === "SQUARE_NOT_FOUND" ||
          error.code === "MEMBERSHIP_NOT_FOUND" ||
          error.code === "ACCOUNT_NOT_FOUND" ||
          error.code === "ACCOUNT_SHARE_NOT_FOUND")) ||
      (error instanceof ChannelError &&
        (error.code === "CHANNEL_NOT_FOUND" ||
          error.code === "DELIVERY_NOT_FOUND")) ||
      (error instanceof AccountError && error.code === "ACCOUNT_NOT_FOUND") ||
      (error instanceof RoutineError &&
        ["ROUTINE_NOT_FOUND", "SYNC_RUN_NOT_FOUND"].includes(error.code)) ||
      (error instanceof SuggestionError &&
        error.code === "SUGGESTION_NOT_FOUND") ||
      (error instanceof A2AError && error.code === "A2A_NOT_FOUND")
    ) {
      return context.json(
        {
          type: "https://town.local/problems/not-found",
          title: "Resource not found",
          status: 404,
          detail: "The requested resource was not found.",
          code: error.code,
        },
        404,
      );
    }
    if (
      (error instanceof ToolRegistryError &&
        ["TOOL_NOT_FOUND", "TOOL_BINDING_NOT_FOUND"].includes(error.code)) ||
      (error instanceof ToolExecutionError &&
        [
          "RUN_NOT_FOUND",
          "TOOL_CALL_NOT_FOUND",
          "APPROVAL_NOT_FOUND",
          "TOOL_BINDING_NOT_FOUND",
          "ACCOUNT_NOT_FOUND",
        ].includes(error.code))
    ) {
      return context.json(
        {
          type: "https://town.local/problems/not-found",
          title: "Resource not found",
          status: 404,
          detail: "The requested Tool or Approval was not found.",
          code: error.code,
        },
        404,
      );
    }
    if (
      error instanceof RoutineError &&
      error.code === "WEBHOOK_RATE_LIMITED"
    ) {
      return context.json(
        {
          type: "https://town.local/problems/rate-limit",
          title: "Webhook rate limit exceeded",
          status: 429,
          detail: "The routine webhook rate limit was exceeded.",
          code: error.code,
        },
        429,
      );
    }
    if (
      (error instanceof RoutineError &&
        ["ROUTINE_CONFLICT", "SYNC_RUN_CONFLICT"].includes(error.code)) ||
      (error instanceof SuggestionError &&
        error.code === "SUGGESTION_CONFLICT") ||
      (error instanceof A2AError && error.code === "A2A_CONFLICT") ||
      (error instanceof ToolRegistryError &&
        ["TOOL_NAME_CONFLICT", "TOOL_BINDING_CONFLICT"].includes(error.code)) ||
      (error instanceof McpRepositoryError &&
        [
          "MCP_SERVER_ALREADY_EXISTS",
          "MCP_BINDING_ALREADY_EXISTS",
          "MCP_SERVER_CONFLICT",
        ].includes(error.code)) ||
      (error instanceof ToolExecutionError &&
        [
          "IDEMPOTENCY_CONFLICT",
          "RUN_STATE_CONFLICT",
          "TOOL_STATE_CONFLICT",
          "APPROVAL_STATE_CONFLICT",
          "APPROVAL_REVISION_CONFLICT",
        ].includes(error.code))
    ) {
      return context.json(
        {
          type: "https://town.local/problems/conflict",
          title: "Tool execution conflict",
          status: 409,
          detail: "The Tool proposal or Approval changed concurrently.",
          code: error.code,
        },
        409,
      );
    }
    if (
      (error instanceof AgentError && error.code === "AGENT_NOT_FOUND") ||
      (error instanceof ThreadError && error.code === "THREAD_NOT_FOUND") ||
      (error instanceof TaskError && error.code === "TASK_NOT_FOUND") ||
      (error instanceof TurnError && error.code === "TASK_NOT_FOUND") ||
      (error instanceof InputRequestError &&
        error.code === "INPUT_REQUEST_NOT_FOUND") ||
      (error instanceof RuntimeError &&
        (error.code === "SESSION_NOT_FOUND" || error.code === "RUN_NOT_FOUND"))
    ) {
      return context.json(
        {
          type: "https://town.local/problems/not-found",
          title: "Resource not found",
          status: 404,
          detail: "The requested resource was not found.",
          code: error.code,
        },
        404,
      );
    }
    if (
      (error instanceof ProfileError &&
        error.code === "PROFILE_ALREADY_EXISTS") ||
      (error instanceof PeopleError &&
        error.code === "PERSON_ALREADY_EXISTS") ||
      (error instanceof WikiError &&
        error.code === "WIKI_DOCUMENT_ALREADY_EXISTS") ||
      (error instanceof RevisionError &&
        (error.code === "REVISION_CONFLICT" ||
          error.code === "REVISION_ALREADY_EXISTS")) ||
      (error instanceof ContentError &&
        (error.code === "CONTENT_CONFLICT" ||
          error.code === "CONTENT_ALREADY_EXISTS" ||
          error.code === "COLLECTION_ALREADY_EXISTS")) ||
      (error instanceof SquareError &&
        (error.code === "SQUARE_ALREADY_EXISTS" ||
          error.code === "MEMBERSHIP_CONFLICT" ||
          error.code === "POLICY_CONFLICT")) ||
      (error instanceof ChannelError &&
        (error.code === "CHANNEL_DISABLED" ||
          error.code === "DELIVERY_CONFLICT"))
    ) {
      return context.json(
        {
          type: "https://town.local/problems/conflict",
          title: "Resource conflict",
          status: 409,
          detail: "The resource changed or already exists.",
          code: error.code,
        },
        409,
      );
    }
    if (
      (error instanceof AgentError &&
        (error.code === "AGENT_REVISION_CONFLICT" ||
          error.code === "PERSONAL_AGENT_ALREADY_EXISTS" ||
          error.code === "AGENT_CALLABLE_CONFLICT")) ||
      (error instanceof ThreadError &&
        (error.code === "THREAD_REVISION_CONFLICT" ||
          error.code === "TASK_THREAD_REQUIRES_TASK_DELETE" ||
          error.code === "TASK_THREAD_REQUIRES_TASK_UPDATE")) ||
      (error instanceof TaskError && error.code === "TASK_REVISION_CONFLICT") ||
      (error instanceof InputRequestError &&
        error.code === "INPUT_REQUEST_ALREADY_RESOLVED") ||
      (error instanceof RuntimeError &&
        (error.code === "IDEMPOTENCY_CONFLICT" ||
          error.code === "RUN_STATE_CONFLICT"))
    ) {
      return context.json(
        {
          type: "https://town.local/problems/conflict",
          title: "Resource conflict",
          status: 409,
          detail: "The resource changed or already exists.",
          code: error.code,
        },
        409,
      );
    }
    if (
      error instanceof McpRepositoryError &&
      error.code === "MCP_SERVER_NOT_FOUND"
    ) {
      return context.json(
        {
          type: "https://town.local/problems/not-found",
          title: "MCP server not found",
          status: 404,
          detail: "The MCP server is not active or is not owned by this user.",
          code: error.code,
        },
        404,
      );
    }
    if (error instanceof KnowledgeSearchError) {
      return context.json(
        {
          type: "https://town.local/problems/invalid-cursor",
          title: "Invalid search cursor",
          status: 400,
          detail: "The cursor cannot be used for this search.",
          code: error.code,
        },
        400,
      );
    }
    if (error instanceof PeopleError && error.code === "PROVENANCE_REQUIRED") {
      return context.json(
        {
          type: "https://town.local/problems/provenance-required",
          title: "Provenance required",
          status: 422,
          detail: "Assistant-derived knowledge requires a source citation.",
          code: error.code,
        },
        422,
      );
    }
    if (
      (error instanceof TaskError && error.code === "REFERENCE_UNAVAILABLE") ||
      (error instanceof TurnError && error.code === "REFERENCE_UNAVAILABLE")
    ) {
      return context.json(
        {
          type: "https://town.local/problems/reference-unavailable",
          title: "Reference unavailable",
          status: 422,
          detail: "The referenced resource is not available.",
          code: error.code,
        },
        422,
      );
    }
    return context.json(
      {
        type: "https://town.local/problems/internal",
        title: "Internal server error",
        status: 500,
        detail: "The request could not be completed.",
        code: "INTERNAL_ERROR",
      },
      500,
    );
  });

  app.get("/v1/health", (context) =>
    context.json({
      status: "ok" as const,
      service: "town-api" as const,
      version: process.env["TOWN_API_VERSION"] ?? "0.0.0",
      time: new Date().toISOString(),
    }),
  );
  app.get("/v1/health/capabilities", (context) =>
    context.json({
      api: dependencies !== undefined,
      auth: dependencies !== undefined,
      harness:
        dependencies?.harnessServer !== undefined ||
        dependencies?.harnessServerFactory !== undefined,
      harnessResponses: dependencies?.harnessResponses === true,
      harnessCodex: dependencies?.harnessCodex === true,
      worker: dependencies?.workerEnabled === true,
      slackEvents: dependencies?.slackSigningSecret !== undefined,
      twilioVoice: dependencies?.twilioAuthToken !== undefined,
      vapiVoice: dependencies?.vapiWebhookSecret !== undefined,
      workspaceTools: dependencies?.workspaceTools === true,
      codeRunner: dependencies?.codeRunner === true,
      e2bSandbox: dependencies?.e2bApiKey !== undefined,
      pipedreamCatalog: dependencies?.pipedream !== undefined,
      voiceSynthesis: dependencies?.voiceProvider !== undefined,
      googleOAuth: dependencies?.googleOAuth !== undefined,
      gmailPubsub: dependencies?.gmailPubsubClientId !== undefined,
      contentStorage:
        dependencies?.contentStorage === undefined
          ? false
          : dependencies?.contentStorage.write === undefined
            ? "read-only"
            : true,
    }),
  );

  if (dependencies !== undefined) {
    // Rate-limit unauthenticated entry points: session establishment,
    // OAuth flows, and webhook receivers. Authenticated /v1/* business
    // routes have their own per-resource limits.
    app.use("/v1/auth/dev-session", rateLimit);
    app.use("/v1/auth/oidc/*", rateLimit);
    app.use("/v1/auth/oauth/*", rateLimit);
    app.use("/v1/accounts/google/oauth/*", rateLimit);
    app.use("/auth/google/*", rateLimit);
    app.use("/v1/accounts/microsoft/oauth/*", rateLimit);
    app.use("/auth/microsoft/*", rateLimit);
    app.use("/v1/integrations/telegram/events/*", rateLimit);
    app.use("/integrations/telegram/events/*", rateLimit);
    app.use("/v1/integrations/whatsapp/events/*", rateLimit);
    app.use("/integrations/whatsapp/events/*", rateLimit);
    app.use("/v1/integrations/slack/events/*", rateLimit);
    app.use("/integrations/slack/events/*", rateLimit);
    app.use("/v1/internal/gmail/pubsub", rateLimit);

    const establishSessionSchema = z
      .object({
        email: z.email(),
        firstName: z.string().trim().min(1).max(100).optional(),
        lastName: z.string().trim().min(1).max(100).optional(),
        timezone: z.string().trim().min(1).max(100).default("UTC"),
      })
      .strict();
    // Email-only login is DEV ONLY. It is registered only when
    // devEmailLoginAllowed() is true (non-production AND explicitly enabled).
    // In production this route does not exist -> 404. Even if misconfigured
    // with DEV_EMAIL_LOGIN_ENABLED=true, the runtime-config guard refuses
    // to start in production (see lib/auth-config.ts).
    if (dependencies.devEmailLoginEnabled === true) {
      app.post("/v1/auth/dev-session", async (context) => {
        const established =
          await dependencies.identityService.establishDevIdentity(
            establishSessionSchema.parse(await context.req.json()),
          );
        // Server-authoritative cookie max age (seconds until absolute expiry).
        const cookieMaxAgeSeconds = Math.floor(
          (established.session.expiresAt.getTime() - Date.now()) / 1000,
        );
        return context.json(
          {
            token: established.token,
            user: established.user,
            session: {
              id: established.session.id,
              expiresAt: established.session.expiresAt,
            },
            cookieMaxAgeSeconds,
          },
          201,
        );
      });
    }
    const authenticate = createAuthMiddleware(dependencies.identityService);
    // Auth middleware must be registered BEFORE session routes so that
    // /v1/me/* routes are protected. In Hono, middleware only applies
    // to routes registered after it.
    app.use("/v1/me", authenticate);
    app.use("/v1/me/*", authenticate);
    if (dependencies.oidcLogin !== undefined) {
      registerOidcLoginRoutes(app, dependencies.oidcLogin);
    }
    if (dependencies.sessionRoutes !== undefined) {
      registerSessionRoutes(app, dependencies.sessionRoutes);
    }
    const adminAllowlist = new Set(
      (dependencies.adminAllowlistEmails ?? []).map((email) =>
        email.trim().toLowerCase(),
      ),
    );
    const requireAdmin = async (
      context: Parameters<typeof authenticate>[0],
      next: () => Promise<void>,
    ) => {
      const email = context.get("identity").user.email.toLowerCase();
      if (!adminAllowlist.has(email))
        return context.json({ code: "ADMIN_NOT_AUTHORIZED" }, 403);
      await next();
    };
    if (dependencies.routineRepository !== undefined)
      registerRoutineWebhookRoutes(app, {
        repository: dependencies.routineRepository,
      });
    if (
      dependencies.sql !== undefined &&
      dependencies.routineRepository !== undefined &&
      dependencies.slackSigningSecret !== undefined
    )
      registerSlackEventsRoute(app, {
        sql: dependencies.sql,
        repository: dependencies.routineRepository,
        signingSecret: dependencies.slackSigningSecret,
      });
    if (
      dependencies.sql !== undefined &&
      dependencies.routineRepository !== undefined &&
      dependencies.twilioAuthToken !== undefined
    )
      registerTwilioVoiceEventsRoute(app, {
        sql: dependencies.sql,
        repository: dependencies.routineRepository,
        authToken: dependencies.twilioAuthToken,
      });
    if (dependencies.voiceProvider !== undefined) {
      app.use("/v1/voice", authenticate);
      app.use("/v1/voice/*", authenticate);
      registerVoiceRoutes(app, dependencies.voiceProvider);
    }
    if (
      dependencies.sql !== undefined &&
      dependencies.routineRepository !== undefined &&
      dependencies.vapiWebhookSecret !== undefined
    )
      registerVapiVoiceEventsRoute(app, {
        sql: dependencies.sql,
        repository: dependencies.routineRepository,
        webhookSecret: dependencies.vapiWebhookSecret,
      });
    if (
      dependencies.sql !== undefined &&
      dependencies.routineRepository !== undefined &&
      dependencies.telegramSecretToken !== undefined
    )
      registerTelegramEventsRoute(app, {
        sql: dependencies.sql,
        repository: dependencies.routineRepository,
        secretToken: dependencies.telegramSecretToken,
      });
    if (
      dependencies.sql !== undefined &&
      dependencies.routineRepository !== undefined &&
      dependencies.whatsappAppSecret !== undefined &&
      dependencies.whatsappVerifyToken !== undefined
    )
      registerWhatsAppEventsRoute(app, {
        sql: dependencies.sql,
        repository: dependencies.routineRepository,
        appSecret: dependencies.whatsappAppSecret,
        verifyToken: dependencies.whatsappVerifyToken,
      });
    if (
      dependencies.sql !== undefined &&
      dependencies.routineRepository !== undefined &&
      dependencies.googleApi !== undefined &&
      dependencies.gmailPubsubClientId !== undefined
    )
      registerGmailPubsubEventsRoute(app, {
        sql: dependencies.sql,
        repository: dependencies.routineRepository,
        google: dependencies.googleApi,
        clientId: dependencies.gmailPubsubClientId,
      });

    if (dependencies.pipedream !== undefined) {
      app.use("/v1/integrations/pipedream", authenticate);
      app.use("/v1/integrations/pipedream/*", authenticate);
      registerPipedreamRoutes(app, dependencies.pipedream);
    }
    if (dependencies.routineRepository !== undefined)
      registerRoutineShareRoutes(app, {
        repository: dependencies.routineRepository,
      });
    app.use("/v1/accounts", authenticate);
    app.use("/v1/accounts/*", authenticate);

    app.get("/v1/me", (context) => {
      const identity = context.get("identity");
      return context.json({ user: identity.user });
    });

    app.delete("/v1/me/session", async (context) => {
      const identity = context.get("identity");
      await dependencies.identityService.revokeSession(
        identity.session.id,
        identity.user.id,
      );
      return context.body(null, 204);
    });

    registerAccountRoutes(app, {
      repository: dependencies.accountRepository,
      ...(dependencies.googleTokenRefresher === undefined
        ? {}
        : { refreshGoogle: dependencies.googleTokenRefresher.refresh }),
    });
    if (dependencies.googleOAuth !== undefined)
      registerGoogleOAuthRoutes(app, dependencies.googleOAuth);
    if (dependencies.microsoftOAuth !== undefined)
      registerMicrosoftOAuthRoutes(app, dependencies.microsoftOAuth);
    if (dependencies.a2aRepository !== undefined) {
      app.use("/v1/a2a", authenticate);
      app.use("/v1/a2a/*", authenticate);
      registerA2ARoutes(app, dependencies.a2aRepository);
    }

    const knowledge = knowledgeDependencies(dependencies);
    if (knowledge !== null) {
      app.use("/v1/profile", authenticate);
      app.use("/v1/profile/*", authenticate);
      app.use("/v1/memories", authenticate);
      app.use("/v1/memories/*", authenticate);
      app.use("/v1/people", authenticate);
      app.use("/v1/people/*", authenticate);
      app.use("/v1/wiki", authenticate);
      app.use("/v1/wiki/*", authenticate);
      app.use("/v1/knowledge", authenticate);
      app.use("/v1/knowledge/*", authenticate);
      registerKnowledgeRoutes(app, knowledge);
    }

    const agents = agentDependencies(dependencies);
    if (agents !== null) {
      app.use("/v1/agents", authenticate);
      app.use("/v1/agents/*", authenticate);
      app.use("/v1/threads", authenticate);
      app.use("/v1/threads/*", authenticate);
      app.use("/v1/tasks", authenticate);
      app.use("/v1/tasks/*", authenticate);
      app.use("/v1/input-requests", authenticate);
      app.use("/v1/input-requests/*", authenticate);
      registerAgentRoutes(app, agents);
    }

    const runtime = runtimeDependencies(dependencies);
    if (runtime !== null) {
      app.use("/v1/threads", authenticate);
      app.use("/v1/threads/*", authenticate);
      app.use("/v1/sessions", authenticate);
      app.use("/v1/sessions/*", authenticate);
      app.use("/v1/runtime-input-requests", authenticate);
      app.use("/v1/runtime-input-requests/*", authenticate);
      registerRuntimeRoutes(app, runtime);
    }

    const tools = toolDependencies(dependencies);
    if (tools !== null) {
      app.use("/v1/tools", authenticate);
      app.use("/v1/tools/*", authenticate);
      app.use("/v1/tool-calls", authenticate);
      app.use("/v1/tool-calls/*", authenticate);
      app.use("/v1/approvals", authenticate);
      app.use("/v1/approvals/*", authenticate);
      registerToolRoutes(app, tools);
    }
    if (dependencies.mcpRepository !== undefined) {
      app.use("/v1/mcp-servers", authenticate);
      app.use("/v1/mcp-servers/*", authenticate);
      app.use("/v1/mcp-server-bindings", authenticate);
      app.use("/v1/mcp-server-bindings/*", authenticate);
      registerMcpRoutes(app, dependencies.mcpRepository);
    }
    if (dependencies.contentRepository !== undefined) {
      app.use("/v1/content", authenticate);
      app.use("/v1/content/*", authenticate);
      registerContentRoutes(app, {
        repository: dependencies.contentRepository,
        ...(dependencies.contentStorage === undefined
          ? {}
          : { storage: dependencies.contentStorage }),
      });
    }
    if (dependencies.squareRepository !== undefined) {
      app.use("/v1/squares", authenticate);
      app.use("/v1/squares/*", authenticate);
      app.use("/squares", authenticate);
      app.use("/squares/*", authenticate);
      registerSquareRoutes(app, { repository: dependencies.squareRepository });
    }
    if (dependencies.sharedAccountRepository !== undefined) {
      app.use("/squares", authenticate);
      app.use("/squares/*", authenticate);
      app.use("/square-account-shares/*", authenticate);
      app.use("/v1/square-account-shares/*", authenticate);
      registerSharedAccountRoutes(app, {
        repository: dependencies.sharedAccountRepository,
      });
    }
    if (dependencies.channelRepository !== undefined) {
      app.use("/v1/channels", authenticate);
      app.use("/v1/channels/*", authenticate);
      app.use("/v1/notification-deliveries", authenticate);
      app.use("/v1/notification-deliveries/*", authenticate);
      app.use("/v1/notification-timeline", authenticate);
      registerChannelRoutes(app, {
        repository: dependencies.channelRepository,
        ...(dependencies.operationsRepository === undefined
          ? {}
          : { audit: dependencies.operationsRepository }),
      });
    }
    if (dependencies.billingRepository !== undefined) {
      app.use("/v1/billing", authenticate);
      registerBillingRoutes(app, {
        repository: dependencies.billingRepository,
      });
    }
    if (dependencies.operationsRepository !== undefined) {
      registerPublicAnalyticsRoutes(app, {
        repository: dependencies.operationsRepository,
      });
      app.use("/v1/operations", authenticate);
      app.use("/v1/operations/*", authenticate);
      registerOperationsRoutes(app, {
        repository: dependencies.operationsRepository,
      });
    }
    if (
      dependencies.sql !== undefined &&
      dependencies.operationsRepository !== undefined
    ) {
      app.use("/admin", authenticate);
      app.use("/admin/*", authenticate);
      app.use("/admin", requireAdmin);
      app.use("/admin/*", requireAdmin);
      app.use("/v1/admin", authenticate);
      app.use("/v1/admin/*", authenticate);
      app.use("/v1/admin", requireAdmin);
      app.use("/v1/admin/*", requireAdmin);
      registerAdminRoutes(app, {
        sql: dependencies.sql,
        operations: dependencies.operationsRepository,
        harnessReady:
          dependencies.harnessServer !== undefined ||
          dependencies.harnessServerFactory !== undefined,
        workerEnabled: dependencies.workerEnabled === true,
        workspaceTools: dependencies.workspaceTools === true,
        codeRunner: dependencies.codeRunner === true,
        e2bSandbox: dependencies.e2bApiKey !== undefined,
        pipedreamCatalog: dependencies.pipedream !== undefined,
        googleOAuthReady: dependencies.googleOAuth !== undefined,
        microsoftOAuthReady: dependencies.microsoftOAuth !== undefined,
        slackEvents: dependencies.slackSigningSecret !== undefined,
        telegramEvents: dependencies.telegramSecretToken !== undefined,
        whatsappEvents: dependencies.whatsappAppSecret !== undefined,
        twilioVoice: dependencies.twilioAuthToken !== undefined,
        vapiVoice: dependencies.vapiWebhookSecret !== undefined,
        voiceSynthesis: dependencies.voiceProvider !== undefined,
        contentStorage:
          dependencies.contentStorage === undefined
            ? false
            : dependencies.contentStorage.write === undefined
              ? "read-only"
              : true,
        ...(dependencies.billingRepository === undefined
          ? {}
          : { billing: dependencies.billingRepository }),
      });
    }
    if (dependencies.routineRepository !== undefined) {
      app.use("/v1/routines", authenticate);
      app.use("/v1/routines/*", authenticate);
      app.use("/v1/routine-templates", authenticate);
      app.use("/v1/routine-templates/*", authenticate);
      app.use("/v1/routine-results", authenticate);
      app.use("/v1/routine-runs", authenticate);
      app.use("/v1/routine-runs/*", authenticate);
      registerRoutineRoutes(app, {
        repository: dependencies.routineRepository,
        ...(dependencies.sql === undefined ? {} : { sql: dependencies.sql }),
        ...(dependencies.routineResultRepository === undefined
          ? {}
          : { results: dependencies.routineResultRepository }),
        ...(dependencies.agentRepository === undefined
          ? {}
          : { agents: dependencies.agentRepository }),
        ...(dependencies.threadRepository === undefined
          ? {}
          : { threads: dependencies.threadRepository }),
        ...(dependencies.sessionRepository === undefined
          ? {}
          : { sessions: dependencies.sessionRepository }),
        ...(dependencies.googleApi === undefined
          ? {}
          : { google: dependencies.googleApi }),
      });
    }
    if (dependencies.suggestionRepository !== undefined) {
      app.use("/v1/suggestions", authenticate);
      app.use("/v1/suggestions/*", authenticate);
      registerSuggestionRoutes(
        app,
        dependencies.suggestionRepository,
        dependencies.agentRepository,
      );
    }
    if (
      dependencies.taskRepository !== undefined ||
      dependencies.routineRepository !== undefined
    ) {
      app.use("/v1/schedule", authenticate);
      app.use("/v1/schedule/*", authenticate);
      registerScheduleRoutes(app, {
        ...(dependencies.taskRepository === undefined
          ? {}
          : { tasks: dependencies.taskRepository }),
        ...(dependencies.routineRepository === undefined
          ? {}
          : { routines: dependencies.routineRepository }),
        accounts: dependencies.accountRepository,
        ...(dependencies.googleApi === undefined
          ? {}
          : { google: dependencies.googleApi }),
      });
    }

    const harnessServer = dependencies.harnessServer;
    if (harnessServer !== undefined) {
      app.use("/v1/harness", authenticate);
      app.use("/v1/harness/*", authenticate);
      app.post("/v1/harness", async (context) => {
        const request = (await context.req.json()) as AppServerRequest;
        const response = await harnessServer.dispatch(request);
        return context.json(response);
      });
    }
    const harnessServerFactory = dependencies.harnessServerFactory;
    if (harnessServerFactory !== undefined) {
      app.use("/v1/harness", authenticate);
      app.use("/v1/harness/*", authenticate);
      app.post("/v1/harness", async (context) => {
        const ownerId = context.get("identity").user.id;
        const server = await harnessServerFactory(ownerId);
        const request = (await context.req.json()) as AppServerRequest;
        return context.json(await server.dispatch(request));
      });
    }
  }

  return app;
}
