import type { Hono } from "hono";
import { z } from "zod";

import { asId } from "@town/contracts";
import {
  resourceTypeSchema,
  type KnowledgeConflictService,
  createKnowledgeContextBuilder,
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
  type GraphNodeType,
  type GraphEdgeType,
} from "@town/knowledge";

import type { AuthVariables } from "./auth.js";

export interface KnowledgeDependencies {
  profileRepository: ProfileRepository;
  memoryRepository: MemoryRepository;
  peopleRepository: PeopleRepository;
  wikiRepository: WikiRepository;
  revisionRepository: RevisionRepository;
  knowledgeSearchRepository: KnowledgeSearchRepository;
  knowledgeConflictService: KnowledgeConflictService;
  knowledgeUpkeepScanner?: WikiUpkeepScanner;
  goalsProjectsRepository?: GoalsProjectsRepository;
  trustedContactsRepository?: TrustedContactsRepository;
  knowledgeGraphRepository?: KnowledgeGraphRepository;
}

const jsonObjectSchema = z.record(z.string(), z.json());
const profileCreateSchema = z.object({ content: jsonObjectSchema }).strict();
const profileUpdateSchema = profileCreateSchema.extend({
  expectedRevision: z.number().int().positive(),
});

const memoryBase = {
  content: z.string().trim().min(1),
  confidence: z.number().min(0).max(1).optional(),
  expiresAt: z.iso.datetime().optional(),
};
const memoryCreateSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("global"), ...memoryBase }).strict(),
  z
    .object({
      scope: z.literal("routine"),
      routineId: z.uuidv7(),
      ...memoryBase,
    })
    .strict(),
]);
const memoryUpdateSchema = z.intersection(
  memoryCreateSchema,
  z.object({
    expectedRevision: z.number().int().positive(),
    status: z.enum(["active", "stale", "superseded", "retired"]),
  }),
);

const personFields = {
  displayName: z.string().trim().min(1),
  primaryEmail: z.email().optional(),
  category: z.enum(["uncategorized", "coworker", "family", "personal"]),
  organization: z.string().trim().min(1).optional(),
  role: z.string().trim().min(1).optional(),
  notes: z.string(),
};
const personCreateSchema = z.object(personFields).strict();
const personUpdateSchema = z
  .object({
    ...personFields,
    expectedRevision: z.number().int().positive(),
  })
  .strict();
const relationshipCreateSchema = z
  .object({
    relatedPersonId: z.uuidv7(),
    relationshipType: z.string().trim().min(1).max(100),
    notes: z.string().max(20_000).default(""),
  })
  .strict();
const relationshipUpdateSchema = relationshipCreateSchema.extend({
  expectedRevision: z.number().int().positive(),
});
const relationshipDeleteQuerySchema = z
  .object({ expectedRevision: z.coerce.number().int().positive() })
  .strict();
const relationshipListQuerySchema = z
  .object({ includeRetired: z.enum(["true", "false"]).default("false") })
  .strict();

const wikiFields = {
  kind: z.enum(["profile", "goal", "project", "page"]),
  slug: z.string().trim().min(1),
  title: z.string().trim().min(1),
  body: z.string(),
};
const wikiCreateSchema = z.object(wikiFields).strict();
const wikiUpdateSchema = z
  .object({
    ...wikiFields,
    expectedRevision: z.number().int().positive(),
  })
  .strict();

const resolveConflictSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    resolution: z.enum(["accept", "reject"]),
  })
  .strict();

const memoryDeleteQuerySchema = z
  .object({ expectedRevision: z.coerce.number().int().positive() })
  .strict();

const searchQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(500),
    types: z.string().trim().min(1).optional(),
    memoryScope: z.enum(["global", "routine"]).optional(),
    routineId: z.uuidv7().optional(),
    includeInactive: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.memoryScope === "routine" && value.routineId === undefined) {
      context.addIssue({
        code: "custom",
        message: "routineId is required for routine memory scope.",
        path: ["routineId"],
      });
    }
    if (value.memoryScope !== "routine" && value.routineId !== undefined) {
      context.addIssue({
        code: "custom",
        message: "routineId requires routine memory scope.",
        path: ["routineId"],
      });
    }
  });
const contextQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(500),
    types: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    maxChars: z.coerce.number().int().min(500).max(50_000).default(12_000),
  })
  .strict();
const upkeepQuerySchema = z
  .object({
    staleAfterDays: z.coerce.number().int().min(1).max(3650).default(30),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

function userCitation(sourceRef: string) {
  return [
    {
      sourceType: "user" as const,
      sourceRef,
      observedAt: new Date(),
    },
  ];
}

export function registerKnowledgeRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: KnowledgeDependencies,
): void {
  app.get("/v1/profile", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      profile: await dependencies.profileRepository.get(ownerId),
    });
  });

  app.post("/v1/profile", async (context) => {
    const ownerId = context.get("identity").user.id;
    const body = profileCreateSchema.parse(await context.req.json());
    const profile = await dependencies.profileRepository.create({
      ownerId,
      content: body.content,
      authorType: "user",
      citations: userCitation("api:profile"),
    });
    return context.json({ profile }, 201);
  });

  app.put("/v1/profile", async (context) => {
    const ownerId = context.get("identity").user.id;
    const body = profileUpdateSchema.parse(await context.req.json());
    const result = await dependencies.profileRepository.update({
      ownerId,
      expectedRevision: body.expectedRevision,
      content: body.content,
      authorType: "user",
      citations: userCitation("api:profile"),
    });
    return context.json(result);
  });

  app.get("/v1/profile/history", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      revisions: await dependencies.profileRepository.history(ownerId),
    });
  });

  app.get("/v1/memories", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      memories: await dependencies.memoryRepository.list(ownerId),
    });
  });

  app.get("/v1/memories/:memoryId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const memoryId = asId<"memory">(context.req.param("memoryId"));
    return context.json({
      memory: await dependencies.memoryRepository.get(ownerId, memoryId),
    });
  });

  app.post("/v1/memories", async (context) => {
    const ownerId = context.get("identity").user.id;
    const body = memoryCreateSchema.parse(await context.req.json());
    const optionalFields = {
      ...(body.confidence === undefined ? {} : { confidence: body.confidence }),
      ...(body.expiresAt === undefined
        ? {}
        : { expiresAt: new Date(body.expiresAt) }),
    };
    const commonFields = {
      ownerId,
      content: body.content,
      status: "active" as const,
      observedAt: new Date(),
      authorType: "user" as const,
      citations: userCitation("api:memory"),
      ...optionalFields,
    };
    const memory = await dependencies.memoryRepository.create(
      body.scope === "global"
        ? { ...commonFields, scope: "global" }
        : {
            ...commonFields,
            scope: "routine",
            routineId: asId<"routine">(body.routineId),
          },
    );
    return context.json({ memory }, 201);
  });

  app.put("/v1/memories/:memoryId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const memoryId = asId<"memory">(context.req.param("memoryId"));
    const body = memoryUpdateSchema.parse(await context.req.json());
    const optionalFields = {
      ...(body.confidence === undefined ? {} : { confidence: body.confidence }),
      ...(body.expiresAt === undefined
        ? {}
        : { expiresAt: new Date(body.expiresAt) }),
    };
    const commonFields = {
      ownerId,
      memoryId,
      expectedRevision: body.expectedRevision,
      content: body.content,
      status: body.status,
      observedAt: new Date(),
      authorType: "user" as const,
      citations: userCitation("api:memory"),
      ...optionalFields,
    };
    const result = await dependencies.memoryRepository.update(
      body.scope === "global"
        ? { ...commonFields, scope: "global" }
        : {
            ...commonFields,
            scope: "routine",
            routineId: asId<"routine">(body.routineId),
          },
    );
    return context.json(result);
  });

  app.delete("/v1/memories/:memoryId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const memoryId = asId<"memory">(context.req.param("memoryId"));
    const query = memoryDeleteQuerySchema.parse(context.req.query());
    const memory = await dependencies.memoryRepository.retire({
      ownerId,
      memoryId,
      expectedRevision: query.expectedRevision,
      authorType: "user",
      citations: userCitation("api:memory-delete"),
    });
    return context.json({ memory });
  });

  app.get("/v1/people", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      people: await dependencies.peopleRepository.list(ownerId),
    });
  });

  app.get("/v1/people/:personId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const personId = asId<"person">(context.req.param("personId"));
    return context.json({
      person: await dependencies.peopleRepository.get(ownerId, personId),
    });
  });

  app.get("/v1/people/:personId/relationships", async (context) => {
    const ownerId = context.get("identity").user.id;
    const personId = asId<"person">(context.req.param("personId"));
    const query = relationshipListQuerySchema.parse(context.req.query());
    return context.json({
      relationships: await dependencies.peopleRepository.listRelationships(
        ownerId,
        personId,
        query.includeRetired === "true",
      ),
    });
  });

  app.post("/v1/people/:personId/relationships", async (context) => {
    const ownerId = context.get("identity").user.id;
    const personId = asId<"person">(context.req.param("personId"));
    const body = relationshipCreateSchema.parse(await context.req.json());
    return context.json(
      {
        relationship: await dependencies.peopleRepository.createRelationship({
          ownerId,
          personId,
          relatedPersonId: asId<"person">(body.relatedPersonId),
          relationshipType: body.relationshipType,
          notes: body.notes,
        }),
      },
      201,
    );
  });

  app.patch("/v1/people/relationships/:relationshipId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const relationshipId = asId<"person-relationship">(
      context.req.param("relationshipId"),
    );
    const body = relationshipUpdateSchema.parse(await context.req.json());
    return context.json({
      relationship: await dependencies.peopleRepository.updateRelationship({
        ownerId,
        relationshipId,
        ...body,
      }),
    });
  });

  app.delete("/v1/people/relationships/:relationshipId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const relationshipId = asId<"person-relationship">(
      context.req.param("relationshipId"),
    );
    const query = relationshipDeleteQuerySchema.parse(context.req.query());
    await dependencies.peopleRepository.retireRelationship(
      ownerId,
      relationshipId,
      query.expectedRevision,
    );
    return context.body(null, 204);
  });

  app.post("/v1/people", async (context) => {
    const ownerId = context.get("identity").user.id;
    const body = personCreateSchema.parse(await context.req.json());
    const { primaryEmail, organization, role, ...personInput } = body;
    const person = await dependencies.peopleRepository.create({
      ownerId,
      ...personInput,
      ...(primaryEmail === undefined ? {} : { primaryEmail }),
      ...(organization === undefined ? {} : { organization }),
      ...(role === undefined ? {} : { role }),
      authorType: "user",
      citations: userCitation("api:person"),
    });
    return context.json({ person }, 201);
  });

  app.put("/v1/people/:personId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const personId = asId<"person">(context.req.param("personId"));
    const body = personUpdateSchema.parse(await context.req.json());
    const { primaryEmail, organization, role, ...personInput } = body;
    const result = await dependencies.peopleRepository.update({
      ownerId,
      personId,
      ...personInput,
      ...(primaryEmail === undefined ? {} : { primaryEmail }),
      ...(organization === undefined ? {} : { organization }),
      ...(role === undefined ? {} : { role }),
      authorType: "user",
      citations: userCitation("api:person"),
    });
    return context.json(result);
  });

  app.get("/v1/wiki", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      documents: await dependencies.wikiRepository.list(ownerId),
    });
  });

  app.get("/v1/wiki/:documentId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const documentId = asId<"wiki">(context.req.param("documentId"));
    return context.json({
      document: await dependencies.wikiRepository.get(ownerId, documentId),
    });
  });

  app.get("/v1/wiki/:documentId/revisions", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      revisions: await dependencies.revisionRepository.list(
        ownerId,
        "wiki",
        asId<"wiki">(context.req.param("documentId")),
      ),
    });
  });

  app.post("/v1/wiki", async (context) => {
    const ownerId = context.get("identity").user.id;
    const body = wikiCreateSchema.parse(await context.req.json());
    const document = await dependencies.wikiRepository.create({
      ownerId,
      ...body,
      authorType: "user",
      citations: userCitation("api:wiki"),
    });
    return context.json({ document }, 201);
  });

  app.put("/v1/wiki/:documentId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const documentId = asId<"wiki">(context.req.param("documentId"));
    const body = wikiUpdateSchema.parse(await context.req.json());
    const result = await dependencies.wikiRepository.update({
      ownerId,
      documentId,
      ...body,
      authorType: "user",
      citations: userCitation("api:wiki"),
    });
    return context.json(result);
  });

  app.get("/v1/knowledge/search", async (context) => {
    const ownerId = context.get("identity").user.id;
    const query = searchQuerySchema.parse(context.req.query());
    const rawTypes = query.types?.split(",").filter(Boolean);
    const types =
      rawTypes === undefined
        ? undefined
        : z.array(resourceTypeSchema).min(1).parse(rawTypes);
    const memoryScope = query.memoryScope;
    const result = await dependencies.knowledgeSearchRepository.search({
      ownerId,
      query: query.q,
      ...(types === undefined ? {} : { types }),
      ...(memoryScope === "global"
        ? { memoryScope: { scope: "global" as const } }
        : memoryScope === "routine"
          ? {
              memoryScope: {
                scope: "routine" as const,
                routineId: asId<"routine">(query.routineId),
              },
            }
          : {}),
      includeInactive: query.includeInactive,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      limit: query.limit,
    });
    return context.json(result);
  });

  app.get("/v1/knowledge/context", async (context) => {
    const ownerId = context.get("identity").user.id;
    const query = contextQuerySchema.parse(context.req.query());
    const rawTypes = query.types?.split(",").filter(Boolean);
    const types =
      rawTypes === undefined
        ? undefined
        : z.array(resourceTypeSchema).min(1).parse(rawTypes);
    const builder = createKnowledgeContextBuilder(
      dependencies.knowledgeSearchRepository,
    );
    return context.json(
      await builder.build({
        ownerId,
        query: query.q,
        ...(types === undefined ? {} : { types }),
        limit: query.limit,
        maxChars: query.maxChars,
      }),
    );
  });

  app.get("/v1/knowledge/conflicts", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      conflicts: await dependencies.knowledgeConflictService.list(ownerId),
    });
  });

  app.get("/v1/knowledge/upkeep", async (context) => {
    const scanner = dependencies.knowledgeUpkeepScanner;
    if (scanner === undefined)
      return context.json({ code: "UPKEEP_NOT_CONFIGURED" }, 503);
    const ownerId = context.get("identity").user.id;
    const query = upkeepQuerySchema.parse(context.req.query());
    return context.json(
      await scanner.scan({
        ownerId,
        staleAfterDays: query.staleAfterDays,
        limit: query.limit,
      }),
    );
  });

  app.post("/v1/knowledge/conflicts/:conflictId/resolve", async (context) => {
    const ownerId = context.get("identity").user.id;
    const conflictId = asId<"knowledge-conflict">(
      context.req.param("conflictId"),
    );
    const body = resolveConflictSchema.parse(await context.req.json());
    return context.json(
      await dependencies.knowledgeConflictService.resolve({
        ownerId,
        conflictId,
        ...body,
      }),
    );
  });

  /* ── Goals ── */
  app.get("/v1/goals", async (context) => {
    const ownerId = context.get("identity").user.id;
    if (dependencies.goalsProjectsRepository === undefined)
      return context.json({ code: "NOT_CONFIGURED" }, 503);
    return context.json(
      await dependencies.goalsProjectsRepository.listGoals(ownerId),
    );
  });

  app.post("/v1/goals", async (context) => {
    const ownerId = context.get("identity").user.id;
    if (dependencies.goalsProjectsRepository === undefined)
      return context.json({ code: "NOT_CONFIGURED" }, 503);
    const body = await context.req.json();
    return context.json(
      await dependencies.goalsProjectsRepository.createGoal({
        ownerId,
        title: body.title,
        description: body.description ?? "",
        status: body.status ?? "active",
        metadata: body.metadata ?? {},
        authorType: "user",
        citations: body.citations ?? [],
      }),
    );
  });

  app.get("/v1/goals/:goalId", async (context) => {
    const ownerId = context.get("identity").user.id;
    if (dependencies.goalsProjectsRepository === undefined)
      return context.json({ code: "NOT_CONFIGURED" }, 503);
    const goalId = asId<"goal">(context.req.param("goalId"));
    return context.json(
      await dependencies.goalsProjectsRepository.getGoal(ownerId, goalId),
    );
  });

  app.put("/v1/goals/:goalId", async (context) => {
    const ownerId = context.get("identity").user.id;
    if (dependencies.goalsProjectsRepository === undefined)
      return context.json({ code: "NOT_CONFIGURED" }, 503);
    const goalId = asId<"goal">(context.req.param("goalId"));
    const body = await context.req.json();
    return context.json(
      await dependencies.goalsProjectsRepository.updateGoal({
        id: goalId,
        ownerId,
        title: body.title,
        description: body.description ?? "",
        status: body.status ?? "active",
        metadata: body.metadata ?? {},
        authorType: "user",
        citations: body.citations ?? [],
        expectedRevision: body.expectedRevision,
      }),
    );
  });

  /* ── Projects ── */
  app.get("/v1/projects", async (context) => {
    const ownerId = context.get("identity").user.id;
    if (dependencies.goalsProjectsRepository === undefined)
      return context.json({ code: "NOT_CONFIGURED" }, 503);
    return context.json(
      await dependencies.goalsProjectsRepository.listProjects(ownerId),
    );
  });

  app.post("/v1/projects", async (context) => {
    const ownerId = context.get("identity").user.id;
    if (dependencies.goalsProjectsRepository === undefined)
      return context.json({ code: "NOT_CONFIGURED" }, 503);
    const body = await context.req.json();
    return context.json(
      await dependencies.goalsProjectsRepository.createProject({
        ownerId,
        title: body.title,
        description: body.description ?? "",
        status: body.status ?? "active",
        ...(body.goalId === undefined ? {} : { goalId: body.goalId }),
        metadata: body.metadata ?? {},
        authorType: "user",
        citations: body.citations ?? [],
      }),
    );
  });

  app.get("/v1/projects/:projectId", async (context) => {
    const ownerId = context.get("identity").user.id;
    if (dependencies.goalsProjectsRepository === undefined)
      return context.json({ code: "NOT_CONFIGURED" }, 503);
    const projectId = asId<"project">(context.req.param("projectId"));
    return context.json(
      await dependencies.goalsProjectsRepository.getProject(ownerId, projectId),
    );
  });

  app.put("/v1/projects/:projectId", async (context) => {
    const ownerId = context.get("identity").user.id;
    if (dependencies.goalsProjectsRepository === undefined)
      return context.json({ code: "NOT_CONFIGURED" }, 503);
    const projectId = asId<"project">(context.req.param("projectId"));
    const body = await context.req.json();
    return context.json(
      await dependencies.goalsProjectsRepository.updateProject({
        id: projectId,
        ownerId,
        title: body.title,
        description: body.description ?? "",
        status: body.status ?? "active",
        ...(body.goalId === undefined ? {} : { goalId: body.goalId }),
        metadata: body.metadata ?? {},
        authorType: "user",
        citations: body.citations ?? [],
        expectedRevision: body.expectedRevision,
      }),
    );
  });

  /* ── Trusted Contacts ── */
  app.get("/v1/trusted-contacts", async (context) => {
    const ownerId = context.get("identity").user.id;
    if (dependencies.trustedContactsRepository === undefined)
      return context.json({ code: "NOT_CONFIGURED" }, 503);
    return context.json(
      await dependencies.trustedContactsRepository.list(ownerId),
    );
  });

  app.post("/v1/trusted-contacts", async (context) => {
    const ownerId = context.get("identity").user.id;
    if (dependencies.trustedContactsRepository === undefined)
      return context.json({ code: "NOT_CONFIGURED" }, 503);
    const body = await context.req.json();
    return context.json(
      await dependencies.trustedContactsRepository.add({
        ownerId,
        scope: body.scope,
        value: body.value,
        ...(body.label === undefined ? {} : { label: body.label }),
      }),
    );
  });

  app.delete("/v1/trusted-contacts/:contactId", async (context) => {
    const ownerId = context.get("identity").user.id;
    if (dependencies.trustedContactsRepository === undefined)
      return context.json({ code: "NOT_CONFIGURED" }, 503);
    const contactId = asId<"trusted-contact">(context.req.param("contactId"));
    await dependencies.trustedContactsRepository.remove(ownerId, contactId);
    return context.json({ ok: true });
  });

  /* ── Knowledge Graph ── */
  app.get("/v1/knowledge-graph/edges", async (context) => {
    const ownerId = context.get("identity").user.id;
    if (dependencies.knowledgeGraphRepository === undefined)
      return context.json({ code: "NOT_CONFIGURED" }, 503);
    const query = context.req.query();
    return context.json(
      await dependencies.knowledgeGraphRepository.listEdges(ownerId, {
        ...(query["fromType"] === undefined
          ? {}
          : { fromType: query["fromType"] as GraphNodeType }),
        ...(query["fromId"] === undefined ? {} : { fromId: query["fromId"] }),
        ...(query["toType"] === undefined
          ? {}
          : { toType: query["toType"] as GraphNodeType }),
        ...(query["toId"] === undefined ? {} : { toId: query["toId"] }),
        ...(query["edgeType"] === undefined
          ? {}
          : { edgeType: query["edgeType"] as GraphEdgeType }),
      }),
    );
  });

  app.post("/v1/knowledge-graph/edges", async (context) => {
    const ownerId = context.get("identity").user.id;
    if (dependencies.knowledgeGraphRepository === undefined)
      return context.json({ code: "NOT_CONFIGURED" }, 503);
    const body = await context.req.json();
    return context.json(
      await dependencies.knowledgeGraphRepository.createEdge({
        ownerId,
        fromType: body.fromType,
        fromId: body.fromId,
        toType: body.toType,
        toId: body.toId,
        edgeType: body.edgeType,
        ...(body.notes === undefined ? {} : { notes: body.notes }),
        metadata: body.metadata ?? {},
      }),
    );
  });

  app.get("/v1/knowledge-graph/neighbors", async (context) => {
    const ownerId = context.get("identity").user.id;
    if (dependencies.knowledgeGraphRepository === undefined)
      return context.json({ code: "NOT_CONFIGURED" }, 503);
    const query = context.req.query();
    return context.json(
      await dependencies.knowledgeGraphRepository.getNeighbors(
        ownerId,
        query["nodeType"] as GraphNodeType,
        query["nodeId"] ?? "",
      ),
    );
  });

  app.delete("/v1/knowledge-graph/edges/:edgeId", async (context) => {
    const ownerId = context.get("identity").user.id;
    if (dependencies.knowledgeGraphRepository === undefined)
      return context.json({ code: "NOT_CONFIGURED" }, 503);
    const edgeId = asId<"graph-edge">(context.req.param("edgeId"));
    const body = await context.req.json();
    await dependencies.knowledgeGraphRepository.retireEdge(
      ownerId,
      edgeId,
      body.expectedRevision,
    );
    return context.json({ ok: true });
  });
}
