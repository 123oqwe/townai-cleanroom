import { Hono } from "hono";
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
import type { AccountRepository, IdentityService } from "@town/identity";
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
  type RuntimeTransitionService,
  type SessionRepository,
} from "@town/runtime";
import {
  ToolExecutionError,
  ToolRegistryError,
  type ToolExecutionRepository,
  type ToolRegistryRepository,
} from "@town/tools";

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
  toolRegistryRepository?: ToolRegistryRepository;
  toolExecutionRepository?: ToolExecutionRepository;
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
  return { sessionRepository, runtimeTransitionService };
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
  const app = new Hono<{ Variables: AuthVariables }>();

  app.onError((error, context) => {
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
      (error instanceof ProfileError && error.code === "PROFILE_NOT_FOUND") ||
      (error instanceof MemoryError && error.code === "MEMORY_NOT_FOUND") ||
      (error instanceof PeopleError && error.code === "PERSON_NOT_FOUND") ||
      (error instanceof WikiError &&
        error.code === "WIKI_DOCUMENT_NOT_FOUND") ||
      (error instanceof RevisionError &&
        (error.code === "RESOURCE_NOT_FOUND" ||
          error.code === "CONFLICT_NOT_FOUND"))
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
      (error instanceof ToolRegistryError &&
        ["TOOL_NAME_CONFLICT", "TOOL_BINDING_CONFLICT"].includes(error.code)) ||
      (error instanceof ToolExecutionError &&
        [
          "IDEMPOTENCY_CONFLICT",
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
          error.code === "REVISION_ALREADY_EXISTS"))
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
          error.code === "PERSONAL_AGENT_ALREADY_EXISTS")) ||
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
    app.use("/v1/me", authenticate);
    app.use("/v1/accounts", authenticate);

    app.get("/v1/me", (context) => {
      const identity = context.get("identity");
      return context.json({ user: identity.user });
    });

    app.get("/v1/accounts", async (context) => {
      const identity = context.get("identity");
      const accounts = await dependencies.accountRepository.listByOwner(
        identity.user.id,
      );
      return context.json({ accounts });
    });

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
  }

  return app;
}
