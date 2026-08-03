import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

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
import { AccountError, GoogleTokenError } from "@town/identity";
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
import type { BillingRepository } from "@town/billing";
import { OperationsError, type OperationsRepository } from "@town/operations";
import {
  SquareError,
  type SquareRepository,
  type SharedAccountRepository,
} from "@town/teams";

import { createAuthMiddleware, type AuthVariables } from "./auth.js";
import { registerAgentRoutes, type AgentDependencies } from "./agent-routes.js";
import {
  registerKnowledgeRoutes,
  type KnowledgeDependencies,
} from "./knowledge-routes.js";
import {
  registerRuntimeRoutes,
  type RuntimeDependencies,
} from "./runtime-routes.js";
import { registerToolRoutes, type ToolDependencies } from "./tool-routes.js";
import { registerMcpRoutes } from "./mcp-routes.js";
import type { McpRepository } from "@town/tools";
import { registerContentRoutes } from "./content-routes.js";
import { registerSquareRoutes } from "./square-routes.js";
import { registerSharedAccountRoutes } from "./shared-account-routes.js";
import { registerChannelRoutes } from "./channel-routes.js";
import { registerBillingRoutes } from "./billing-routes.js";
import { registerOperationsRoutes } from "./operations-routes.js";
import {
  registerRoutineRoutes,
  registerRoutineShareRoutes,
  registerRoutineWebhookRoutes,
} from "./routine-routes.js";
import type { RoutineRepository } from "@town/routines";
import { RoutineError } from "@town/routines";
import { registerAccountRoutes } from "./account-routes.js";
import {
  registerGoogleOAuthRoutes,
  type GoogleOAuthDependencies,
} from "./google-oauth-routes.js";
import { registerSuggestionRoutes } from "./suggestion-routes.js";
import type { SuggestionRepository } from "@town/suggestions";
import { SuggestionError } from "@town/suggestions";
import { registerA2ARoutes } from "./a2a-routes.js";
import type { A2ARepository } from "@town/a2a";
import { A2AError } from "@town/a2a";

export interface AppDependencies {
  identityService: IdentityService;
  accountRepository: AccountRepository;
  profileRepository?: ProfileRepository;
  memoryRepository?: MemoryRepository;
  peopleRepository?: PeopleRepository;
  wikiRepository?: WikiRepository;
  revisionRepository?: RevisionRepository;
  knowledgeSearchRepository?: KnowledgeSearchRepository;
  knowledgeConflictService?: KnowledgeConflictService;
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
  squareRepository?: SquareRepository;
  sharedAccountRepository?: SharedAccountRepository;
  channelRepository?: ChannelRepository;
  billingRepository?: BillingRepository;
  operationsRepository?: OperationsRepository;
  routineRepository?: RoutineRepository;
  suggestionRepository?: SuggestionRepository;
  a2aRepository?: A2ARepository;
  googleOAuth?: GoogleOAuthDependencies;
  googleTokenRefresher?: GoogleTokenRefresher;
  webOrigin?: string;
  harnessServer?: AppServer;
  harnessServerFactory?: (ownerId: string) => AppServer | Promise<AppServer>;
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
    if (error instanceof GoogleTokenError) {
      const status = error.code === "GOOGLE_TOKEN_NOT_CONFIGURED" ? 503 : 502;
      return context.json(
        {
          type: "https://town.local/problems/google-token",
          title: "Google token refresh failed",
          status,
          detail: error.message,
          code: error.code,
        },
        status,
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
      const status = error.code === "AUDIT_CONFLICT" ? 409 : 400;
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

  if (dependencies !== undefined) {
    const authenticate = createAuthMiddleware(dependencies.identityService);
    if (dependencies.routineRepository !== undefined)
      registerRoutineWebhookRoutes(app, {
        repository: dependencies.routineRepository,
      });
    if (dependencies.routineRepository !== undefined)
      registerRoutineShareRoutes(app, {
        repository: dependencies.routineRepository,
      });
    app.use("/v1/me", authenticate);
    app.use("/v1/accounts", authenticate);

    app.get("/v1/me", (context) => {
      const identity = context.get("identity");
      return context.json({ user: identity.user });
    });

    registerAccountRoutes(app, {
      repository: dependencies.accountRepository,
      ...(dependencies.googleTokenRefresher === undefined
        ? {}
        : { refreshGoogle: dependencies.googleTokenRefresher.refresh }),
    });
    if (dependencies.googleOAuth !== undefined)
      registerGoogleOAuthRoutes(app, dependencies.googleOAuth);
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
      registerAgentRoutes(app, agents);
    }

    const runtime = runtimeDependencies(dependencies);
    if (runtime !== null) {
      app.use("/v1/threads", authenticate);
      app.use("/v1/threads/*", authenticate);
      app.use("/v1/sessions", authenticate);
      app.use("/v1/sessions/*", authenticate);
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
      });
    }
    if (dependencies.squareRepository !== undefined) {
      app.use("/v1/squares", authenticate);
      app.use("/v1/squares/*", authenticate);
      registerSquareRoutes(app, { repository: dependencies.squareRepository });
    }
    if (dependencies.sharedAccountRepository !== undefined) {
      app.use("/v1/square-account-shares/*", authenticate);
      registerSharedAccountRoutes(app, {
        repository: dependencies.sharedAccountRepository,
      });
    }
    if (dependencies.channelRepository !== undefined) {
      app.use("/v1/channels", authenticate);
      app.use("/v1/channels/*", authenticate);
      app.use("/v1/notification-deliveries", authenticate);
      registerChannelRoutes(app, {
        repository: dependencies.channelRepository,
      });
    }
    if (dependencies.billingRepository !== undefined) {
      app.use("/v1/billing", authenticate);
      registerBillingRoutes(app, {
        repository: dependencies.billingRepository,
      });
    }
    if (dependencies.operationsRepository !== undefined) {
      app.use("/v1/operations", authenticate);
      app.use("/v1/operations/*", authenticate);
      registerOperationsRoutes(app, {
        repository: dependencies.operationsRepository,
      });
    }
    if (dependencies.routineRepository !== undefined) {
      app.use("/v1/routines", authenticate);
      app.use("/v1/routines/*", authenticate);
      registerRoutineRoutes(app, {
        repository: dependencies.routineRepository,
        ...(dependencies.agentRepository === undefined
          ? {}
          : { agents: dependencies.agentRepository }),
        ...(dependencies.threadRepository === undefined
          ? {}
          : { threads: dependencies.threadRepository }),
        ...(dependencies.sessionRepository === undefined
          ? {}
          : { sessions: dependencies.sessionRepository }),
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
