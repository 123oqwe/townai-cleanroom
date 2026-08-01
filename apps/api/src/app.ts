import { Hono } from "hono";
import { z } from "zod";

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

import { createAuthMiddleware, type AuthVariables } from "./auth.js";
import {
  registerKnowledgeRoutes,
  type KnowledgeDependencies,
} from "./knowledge-routes.js";

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
  }

  return app;
}
