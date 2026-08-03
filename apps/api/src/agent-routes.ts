import type { Hono } from "hono";
import { z } from "zod";

import type {
  AgentRepository,
  InputRequestRepository,
  TaskRepository,
  ThreadRepository,
  TurnRepository,
} from "@town/agents";
import {
  approvalModeSchema,
  taskStatusSchema,
  threadKindSchema,
  threadStatusSchema,
} from "@town/agents";
import { asId } from "@town/contracts";

import type { AuthVariables } from "./auth.js";

export interface AgentDependencies {
  agentRepository: AgentRepository;
  threadRepository: ThreadRepository;
  turnRepository: TurnRepository;
  taskRepository: TaskRepository;
  inputRequestRepository: InputRequestRepository;
}

const booleanQuery = z
  .enum(["true", "false"])
  .transform((value) => value === "true");
const agentSnapshotFields = {
  displayName: z.string().trim().min(1).max(100),
  instructions: z.string().max(50_000),
  defaultApprovalMode: approvalModeSchema,
  callableRoutineIds: z.array(z.uuidv7()).max(100).default([]),
};
const agentCreateSchema = z.object(agentSnapshotFields).strict();
const agentPublishSchema = z
  .object({
    ...agentSnapshotFields,
    expectedRevision: z.number().int().positive(),
    changeReason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
const pageQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
const threadCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    approvalMode: approvalModeSchema,
  })
  .strict();
const threadListSchema = pageQuerySchema
  .extend({
    kind: threadKindSchema.optional(),
    status: threadStatusSchema.optional(),
    pinned: booleanQuery.optional(),
    unread: booleanQuery.optional(),
  })
  .strict();
const threadUpdateSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    title: z.string().trim().min(1).max(500),
    status: threadStatusSchema,
    pinned: z.boolean(),
    approvalMode: approvalModeSchema,
    forceUnread: z.boolean(),
  })
  .strict();
const markReadSchema = z
  .object({ throughSequence: z.number().int().nonnegative().optional() })
  .strict();
const deleteQuerySchema = z
  .object({ expectedRevision: z.coerce.number().int().positive() })
  .strict();
const taskCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    description: z.string().max(20_000),
    approvalMode: approvalModeSchema,
    scheduledFor: z.iso.datetime().optional(),
    sourceThreads: z.array(z.uuidv7()).max(100),
  })
  .strict();
const taskUpdateSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    title: z.string().trim().min(1).max(500),
    description: z.string().max(20_000),
    status: taskStatusSchema,
    scheduledFor: z.iso.datetime().nullable(),
  })
  .strict();
const taskListSchema = pageQuerySchema
  .extend({
    status: taskStatusSchema.optional(),
    scheduledFrom: z.iso.datetime().optional(),
    scheduledTo: z.iso.datetime().optional(),
    unread: booleanQuery.optional(),
  })
  .strict();
const emptyBodySchema = z.object({}).strict();
const inputResponseSchema = z
  .object({ response: z.string().trim().min(1).max(50_000) })
  .strict();

export function registerAgentRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: AgentDependencies,
): void {
  app.post("/v1/agents/personal", async (context) => {
    const ownerId = context.get("identity").user.id;
    const body = agentCreateSchema.parse(await context.req.json());
    const agent = await dependencies.agentRepository.createPersonal({
      ownerId,
      ...body,
    });
    return context.json({ agent }, 201);
  });

  app.get("/v1/agents/personal", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      agent: await dependencies.agentRepository.getPersonal(ownerId),
    });
  });

  app.post("/v1/agents/routines", async (context) => {
    const ownerId = context.get("identity").user.id;
    const body = agentCreateSchema.parse(await context.req.json());
    const agent = await dependencies.agentRepository.createRoutine({
      ownerId,
      ...body,
    });
    return context.json({ agent }, 201);
  });

  app.get("/v1/agents/routines", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      agents: await dependencies.agentRepository.listRoutines(ownerId),
    });
  });

  app.put("/v1/agents/routines/:agentId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const body = agentPublishSchema.parse(await context.req.json());
    const agent = await dependencies.agentRepository.publishRoutine({
      ownerId,
      agentId: asId<"agent">(z.uuidv7().parse(context.req.param("agentId"))),
      ...body,
    });
    return context.json({ agent });
  });

  app.put("/v1/agents/personal", async (context) => {
    const ownerId = context.get("identity").user.id;
    const body = agentPublishSchema.parse(await context.req.json());
    return context.json({
      agent: await dependencies.agentRepository.publishPersonal({
        ownerId,
        ...body,
      }),
    });
  });

  app.get("/v1/agents/personal/versions", async (context) => {
    const ownerId = context.get("identity").user.id;
    const query = pageQuerySchema.parse(context.req.query());
    const agent = await dependencies.agentRepository.getPersonal(ownerId);
    return context.json(
      await dependencies.agentRepository.listVersions({
        ownerId,
        agentId: agent.id,
        kind: "personal",
        ...query,
      }),
    );
  });

  app.get("/v1/agents/routines/:agentId/versions", async (context) => {
    const ownerId = context.get("identity").user.id;
    const query = pageQuerySchema.parse(context.req.query());
    const agentId = asId<"agent">(
      z.uuidv7().parse(context.req.param("agentId")),
    );
    return context.json(
      await dependencies.agentRepository.listVersions({
        ownerId,
        agentId,
        kind: "routine",
        ...query,
      }),
    );
  });

  app.post("/v1/threads", async (context) => {
    const ownerId = context.get("identity").user.id;
    const body = threadCreateSchema.parse(await context.req.json());
    const agent = await dependencies.agentRepository.getPersonal(ownerId);
    const thread = await dependencies.threadRepository.createAssistant({
      ownerId,
      agentId: agent.id,
      ...body,
    });
    return context.json({ thread }, 201);
  });

  app.get("/v1/threads", async (context) => {
    const ownerId = context.get("identity").user.id;
    const query = threadListSchema.parse(context.req.query());
    return context.json(
      await dependencies.threadRepository.list({
        ownerId,
        ...(query.kind === undefined ? {} : { kinds: [query.kind] }),
        ...(query.status === undefined ? {} : { statuses: [query.status] }),
        ...(query.pinned === undefined ? {} : { pinned: query.pinned }),
        ...(query.unread === undefined ? {} : { unread: query.unread }),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        limit: query.limit,
      }),
    );
  });

  app.get("/v1/threads/:threadId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const threadId = asId<"thread">(context.req.param("threadId"));
    return context.json({
      thread: await dependencies.threadRepository.get(ownerId, threadId),
    });
  });

  app.patch("/v1/threads/:threadId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const threadId = asId<"thread">(context.req.param("threadId"));
    const body = threadUpdateSchema.parse(await context.req.json());
    return context.json({
      thread: await dependencies.threadRepository.update({
        ownerId,
        threadId,
        ...body,
      }),
    });
  });

  app.post("/v1/threads/:threadId/mark-read", async (context) => {
    const ownerId = context.get("identity").user.id;
    const threadId = asId<"thread">(context.req.param("threadId"));
    const body = markReadSchema.parse(await context.req.json());
    return context.json({
      thread: await dependencies.threadRepository.markRead({
        ownerId,
        threadId,
        ...body,
      }),
    });
  });

  app.delete("/v1/threads/:threadId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const threadId = asId<"thread">(context.req.param("threadId"));
    const query = deleteQuerySchema.parse(context.req.query());
    await dependencies.threadRepository.removeAssistant({
      ownerId,
      threadId,
      expectedRevision: query.expectedRevision,
    });
    return context.body(null, 204);
  });

  app.get("/v1/threads/:threadId/turns", async (context) => {
    const ownerId = context.get("identity").user.id;
    const threadId = asId<"thread">(context.req.param("threadId"));
    const query = pageQuerySchema.parse(context.req.query());
    return context.json(
      await dependencies.turnRepository.list({ ownerId, threadId, ...query }),
    );
  });

  app.post("/v1/tasks", async (context) => {
    const ownerId = context.get("identity").user.id;
    const body = taskCreateSchema.parse(await context.req.json());
    const agent = await dependencies.agentRepository.getPersonal(ownerId);
    const detail = await dependencies.taskRepository.create({
      ownerId,
      agentId: agent.id,
      title: body.title,
      description: body.description,
      approvalMode: body.approvalMode,
      sourceThreads: body.sourceThreads.map((id) => asId<"thread">(id)),
      ...(body.scheduledFor === undefined
        ? {}
        : { scheduledFor: new Date(body.scheduledFor) }),
    });
    return context.json(detail, 201);
  });

  app.get("/v1/tasks", async (context) => {
    const ownerId = context.get("identity").user.id;
    const query = taskListSchema.parse(context.req.query());
    return context.json(
      await dependencies.taskRepository.list({
        ownerId,
        ...(query.status === undefined ? {} : { statuses: [query.status] }),
        ...(query.scheduledFrom === undefined
          ? {}
          : { scheduledFrom: new Date(query.scheduledFrom) }),
        ...(query.scheduledTo === undefined
          ? {}
          : { scheduledTo: new Date(query.scheduledTo) }),
        ...(query.unread === undefined ? {} : { unread: query.unread }),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        limit: query.limit,
      }),
    );
  });

  app.get("/v1/tasks/:taskId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const taskId = asId<"task">(context.req.param("taskId"));
    return context.json(await dependencies.taskRepository.get(ownerId, taskId));
  });

  app.patch("/v1/tasks/:taskId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const taskId = asId<"task">(context.req.param("taskId"));
    const body = taskUpdateSchema.parse(await context.req.json());
    return context.json(
      await dependencies.taskRepository.update({
        ownerId,
        taskId,
        expectedRevision: body.expectedRevision,
        title: body.title,
        description: body.description,
        status: body.status,
        scheduledFor:
          body.scheduledFor === null ? null : new Date(body.scheduledFor),
      }),
    );
  });

  app.delete("/v1/tasks/:taskId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const taskId = asId<"task">(context.req.param("taskId"));
    const query = deleteQuerySchema.parse(context.req.query());
    await dependencies.taskRepository.remove({
      ownerId,
      taskId,
      expectedRevision: query.expectedRevision,
    });
    return context.body(null, 204);
  });

  app.post("/v1/tasks/:taskId/mark-read", async (context) => {
    const ownerId = context.get("identity").user.id;
    const taskId = asId<"task">(context.req.param("taskId"));
    emptyBodySchema.parse(await context.req.json());
    return context.json(
      await dependencies.taskRepository.markRead({ ownerId, taskId }),
    );
  });

  app.get("/v1/tasks/:taskId/input-requests", async (context) => {
    const ownerId = context.get("identity").user.id;
    const taskId = asId<"task">(context.req.param("taskId"));
    return context.json({
      inputRequests: await dependencies.inputRequestRepository.list({
        ownerId,
        taskId,
      }),
    });
  });

  app.post(
    "/v1/tasks/:taskId/input-requests/:requestId/respond",
    async (context) => {
      const ownerId = context.get("identity").user.id;
      const taskId = asId<"task">(context.req.param("taskId"));
      const requestId = asId<"input-request">(context.req.param("requestId"));
      const body = inputResponseSchema.parse(await context.req.json());
      return context.json({
        inputRequest: await dependencies.inputRequestRepository.answer({
          ownerId,
          taskId,
          requestId,
          response: body.response,
        }),
      });
    },
  );
}
