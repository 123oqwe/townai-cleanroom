import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { z } from "zod";

import { asId } from "@town/contracts";
import type {
  AgentRepository,
  InputRequestRepository,
  TaskRepository,
  ThreadRepository,
  TurnRepository,
} from "@town/agents";
import type { AuthVariables } from "../src/auth.js";
import { registerAgentRoutes } from "../src/agent-routes.js";

const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");
const routineId = asId<"agent">("01900000-0000-7000-8000-000000000002");
const personalAgentVersionId = asId<"agent-version">(
  "01900000-0000-7000-8000-000000000003",
);
const routineAgentVersionId = asId<"agent-version">(
  "01900000-0000-7000-8000-000000000004",
);
const personalId = asId<"agent">("01900000-0000-7000-8000-000000000010");
const threadId = asId<"thread">("01900000-0000-7000-8000-000000000020");
const taskId = asId<"task">("01900000-0000-7000-8000-000000000030");
const taskDetailSourceId = asId<"task-source">(
  "01900000-0000-7000-8000-000000000031",
);
const turnId = asId<"thread-turn">("01900000-0000-7000-8000-000000000040");
const inputRequestId = asId<"input-request">(
  "01900000-0000-7000-8000-000000000050",
);
const deliveryTaskId = asId<"task">("01900000-0000-7000-8000-000000000060");
function withErrorMapping(app: Hono<{ Variables: AuthVariables }>) {
  app.onError((error, context) => {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return context.json({ code: "INVALID_REQUEST" }, 400);
    return context.json({ code: "INTERNAL_ERROR", detail: String(error) }, 500);
  });
}

function withIdentity(app: Hono<{ Variables: AuthVariables }>) {
  app.use("*", async (context, next) => {
    context.set("identity", {
      user: { id: ownerId, email: "owner@example.test" },
    });
    await next();
  });
}

function buildAgentApp(dependencies: {
  agentRepository: AgentRepository;
  threadRepository: ThreadRepository;
  turnRepository: TurnRepository;
  taskRepository: TaskRepository;
  inputRequestRepository: InputRequestRepository;
}) {
  const app = new Hono<{ Variables: AuthVariables }>();
  withErrorMapping(app);
  withIdentity(app);
  registerAgentRoutes(app, dependencies);
  return app;
}

describe("agent routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("manages agent lifecycle, threads, tasks, turns, and input requests", async () => {
    const personalAgent = {
      id: personalId,
      ownerId,
      kind: "personal" as const,
      status: "active" as const,
      revision: 1,
      activeVersion: {
        id: personalAgentVersionId,
        agentId: personalId,
        version: 1,
        snapshot: {
          displayName: "Personal",
          instructions: "Be calm.",
          defaultApprovalMode: "respect_tool_setting" as const,
          callableRoutineIds: [routineId],
        },
        changeReason: null,
        createdBy: "user" as const,
        createdAt: new Date("2026-08-01T10:00:00.000Z"),
      },
      createdAt: new Date("2026-08-01T09:00:00.000Z"),
      updatedAt: new Date("2026-08-01T09:00:00.000Z"),
    };
    const personalAgentUpdated = {
      ...personalAgent,
      revision: 2,
      activeVersion: {
        ...personalAgent.activeVersion,
        version: 2,
        snapshot: {
          ...personalAgent.activeVersion.snapshot,
          instructions: "Be proactive.",
        },
        changeReason: "manual-update",
        createdAt: new Date("2026-08-01T09:30:00.000Z"),
      },
    };
    const routineAgent = {
      id: routineId,
      ownerId,
      kind: "routine" as const,
      status: "active" as const,
      revision: 1,
      activeVersion: {
        id: routineAgentVersionId,
        agentId: routineId,
        version: 1,
        snapshot: {
          displayName: "Routine",
          instructions: "Run tidy loops.",
          defaultApprovalMode: "autonomous" as const,
          callableRoutineIds: [],
        },
        changeReason: null,
        createdBy: "user" as const,
        createdAt: new Date("2026-08-01T07:00:00.000Z"),
      },
      createdAt: new Date("2026-08-01T07:00:00.000Z"),
      updatedAt: new Date("2026-08-01T07:00:00.000Z"),
    };
    const routineAgentPublished = {
      ...routineAgent,
      revision: 2,
      activeVersion: {
        ...routineAgent.activeVersion,
        version: 2,
        snapshot: {
          ...routineAgent.activeVersion.snapshot,
          instructions: "Run tidy loops with checks.",
        },
        createdAt: new Date("2026-08-01T07:30:00.000Z"),
      },
    };
    const versionPage = {
      items: [personalAgent.activeVersion, personalAgentUpdated.activeVersion],
      nextCursor: "next-versions",
    };
    const routineVersionPage = {
      items: [routineAgent.activeVersion, routineAgentPublished.activeVersion],
      nextCursor: null,
    };

    const thread = {
      id: threadId,
      ownerId,
      agentId: personalId,
      kind: "assistant" as const,
      title: "Daily check-in",
      approvalMode: "respect_tool_setting" as const,
      status: "active" as const,
      pinnedAt: null,
      revision: 3,
      lastTurnSequence: 2,
      readThroughSequence: 0,
      unread: true,
      createdAt: new Date("2026-08-01T11:00:00.000Z"),
      updatedAt: new Date("2026-08-01T11:01:00.000Z"),
    };
    const threadUpdated = {
      ...thread,
      title: "Daily check-in updated",
      status: "archived" as const,
      revision: 4,
      pinnedAt: new Date("2026-08-01T11:30:00.000Z"),
      readThroughSequence: 2,
      unread: false,
      updatedAt: new Date("2026-08-01T11:45:00.000Z"),
    };
    const threadMarkedRead = {
      ...threadUpdated,
      readThroughSequence: 4,
      unread: false,
    };
    const turn = {
      id: turnId,
      ownerId,
      threadId,
      sequence: 1,
      role: "user" as const,
      text: "How are we doing?",
      sourceType: "user" as const,
      sourceRef: null,
      mentions: [],
      createdAt: new Date("2026-08-01T11:10:00.000Z"),
    };
    const taskDetail = {
      task: {
        id: taskId,
        ownerId,
        threadId,
        title: "Prepare a report",
        description: "Quarterly summary",
        status: "open" as const,
        scheduledFor: new Date("2026-08-01T12:00:00.000Z"),
        revision: 1,
        completedAt: null,
        unread: false,
        createdAt: new Date("2026-08-01T12:01:00.000Z"),
        updatedAt: new Date("2026-08-01T12:01:00.000Z"),
      },
      thread,
      sources: [
        {
          id: taskDetailSourceId,
          sourceType: "task" as const,
          sourceRef: threadId,
          accountId: null,
          sourceLabel: "seed",
          createdAt: new Date("2026-08-01T12:02:00.000Z"),
        },
      ],
    };
    const taskDetailUpdated = {
      ...taskDetail,
      task: { ...taskDetail.task, status: "completed" as const, revision: 2 },
    };
    const taskDetailMarkedRead = {
      ...taskDetailUpdated,
      task: { ...taskDetailUpdated.task, unread: false },
    };
    const inputRequest = {
      id: inputRequestId,
      taskId,
      prompt: "What should I prioritize?",
      status: "pending" as const,
      response: null,
      requestedAt: new Date("2026-08-01T12:30:00.000Z"),
      answeredAt: null,
      cancelledAt: null,
    };
    const inputRequestAnswered = {
      ...inputRequest,
      status: "answered" as const,
      response: "Focus on customers",
      answeredAt: new Date("2026-08-01T12:31:00.000Z"),
    };

    const agentRepository = {
      createPersonal: vi.fn().mockResolvedValue(personalAgent),
      getPersonal: vi.fn().mockResolvedValue(personalAgent),
      createRoutine: vi.fn().mockResolvedValue(routineAgent),
      listRoutines: vi.fn().mockResolvedValue([routineAgent]),
      publishRoutine: vi.fn().mockResolvedValue(routineAgentPublished),
      listVersions: vi.fn((input) =>
        input.agentId === routineId ? routineVersionPage : versionPage,
      ),
      publishPersonal: vi.fn().mockResolvedValue(personalAgentUpdated),
    } as unknown as AgentRepository;
    const threadRepository = {
      createAssistant: vi.fn().mockResolvedValue(thread),
      list: vi
        .fn()
        .mockResolvedValue({ items: [thread], nextCursor: "next-threads" }),
      get: vi.fn().mockResolvedValue(thread),
      update: vi.fn().mockResolvedValue(threadUpdated),
      markRead: vi.fn().mockResolvedValue(threadMarkedRead),
      removeAssistant: vi.fn().mockResolvedValue(undefined),
    } as unknown as ThreadRepository;
    const turnRepository = {
      list: vi.fn().mockResolvedValue({
        items: [turn],
        nextCursor: null,
      }),
    } as unknown as TurnRepository;
    const taskRepository = {
      create: vi.fn().mockResolvedValue(taskDetail),
      list: vi.fn().mockResolvedValue({
        items: [taskDetail],
        nextCursor: "task-next",
      }),
      get: vi.fn().mockResolvedValue(taskDetail),
      update: vi.fn().mockResolvedValue(taskDetailUpdated),
      remove: vi.fn().mockResolvedValue(undefined),
      markRead: vi.fn().mockResolvedValue(taskDetailMarkedRead),
    } as unknown as TaskRepository;
    const inputRequestRepository = {
      list: vi.fn().mockResolvedValue([inputRequest]),
      listPending: vi.fn().mockResolvedValue([inputRequest]),
      answer: vi.fn().mockResolvedValue(inputRequestAnswered),
    } as unknown as InputRequestRepository;

    const app = buildAgentApp({
      agentRepository,
      threadRepository,
      turnRepository,
      taskRepository,
      inputRequestRepository,
    });

    const personalCreate = await app.request("/v1/agents/personal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "Personal",
        instructions: "Be calm.",
        defaultApprovalMode: "respect_tool_setting",
      }),
    });
    const personalGet = await app.request("/v1/agents/personal");
    const routineCreate = await app.request("/v1/agents/routines", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "Routine",
        instructions: "Run tidy loops.",
        defaultApprovalMode: "autonomous",
        callableRoutineIds: [routineId],
      }),
    });
    const routines = await app.request("/v1/agents/routines");
    const routinePublish = await app.request(
      `/v1/agents/routines/${routineId}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: "Routine",
          instructions: "Run tidy loops with checks.",
          defaultApprovalMode: "autonomous",
          expectedRevision: 1,
        }),
      },
    );
    const personalPublish = await app.request("/v1/agents/personal", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "Personal",
        instructions: "Be proactive.",
        defaultApprovalMode: "respect_tool_setting",
        expectedRevision: 1,
      }),
    });
    const personalVersions = await app.request(
      "/v1/agents/personal/versions?limit=2&cursor=personal-cursor",
    );
    const routineVersions = await app.request(
      `/v1/agents/routines/${routineId}/versions?limit=1`,
    );

    const threadCreate = await app.request("/v1/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Daily check-in",
        approvalMode: "respect_tool_setting",
      }),
    });
    const threadList = await app.request(
      "/v1/threads?kind=assistant&status=active&pinned=true&unread=false&limit=5&cursor=thread-cursor",
    );
    const threadGet = await app.request(`/v1/threads/${threadId}`);
    const threadUpdate = await app.request(`/v1/threads/${threadId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 3,
        title: "Daily check-in updated",
        status: "archived",
        pinned: true,
        approvalMode: "respect_tool_setting",
        forceUnread: true,
      }),
    });
    const threadMarkRead = await app.request(
      `/v1/threads/${threadId}/mark-read`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ throughSequence: 4 }),
      },
    );
    const threadDelete = await app.request(
      `/v1/threads/${threadId}?expectedRevision=4`,
      { method: "DELETE" },
    );
    const turns = await app.request(`/v1/threads/${threadId}/turns?limit=10`);

    const taskCreate = await app.request("/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Prepare a report",
        description: "Quarterly summary",
        approvalMode: "respect_tool_setting",
        scheduledFor: "2026-08-01T12:00:00.000Z",
        sourceThreads: [threadId],
      }),
    });
    const taskList = await app.request(
      "/v1/tasks?status=open&scheduledFrom=2026-08-01T00:00:00.000Z&scheduledTo=2026-08-31T23:59:59.000Z&unread=false&limit=25&cursor=task-cursor",
    );
    const taskGet = await app.request(`/v1/tasks/${taskId}`);
    const taskUpdate = await app.request(`/v1/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 1,
        title: "Prepare a report",
        description: "Quarterly summary",
        status: "completed",
        scheduledFor: null,
      }),
    });
    const taskDelete = await app.request(
      `/v1/tasks/${taskId}?expectedRevision=2`,
      {
        method: "DELETE",
      },
    );
    const taskMarkRead = await app.request(`/v1/tasks/${taskId}/mark-read`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const taskRequests = await app.request(
      `/v1/tasks/${taskId}/input-requests`,
    );
    const pendingRequests = await app.request("/v1/input-requests");
    const responded = await app.request(
      `/v1/tasks/${taskId}/input-requests/${inputRequestId}/respond`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response: "Focus on customers" }),
      },
    );

    expect(personalCreate.status).toBe(201);
    expect(personalGet.status).toBe(200);
    expect(routineCreate.status).toBe(201);
    expect(routines.status).toBe(200);
    expect(routinePublish.status).toBe(200);
    expect(personalPublish.status).toBe(200);
    expect(personalVersions.status).toBe(200);
    expect(routineVersions.status).toBe(200);
    expect(threadCreate.status).toBe(201);
    expect(threadList.status).toBe(200);
    expect(threadGet.status).toBe(200);
    expect(threadUpdate.status).toBe(200);
    expect(threadMarkRead.status).toBe(200);
    expect(threadDelete.status).toBe(204);
    expect(turns.status).toBe(200);
    expect(taskCreate.status).toBe(201);
    expect(taskList.status).toBe(200);
    expect(taskGet.status).toBe(200);
    expect(taskUpdate.status).toBe(200);
    expect(taskDelete.status).toBe(204);
    expect(taskMarkRead.status).toBe(200);
    expect(taskRequests.status).toBe(200);
    expect(pendingRequests.status).toBe(200);
    expect(responded.status).toBe(200);

    expect(await personalCreate.json()).toMatchObject({
      agent: expect.objectContaining({
        id: personalId,
        kind: "personal",
        ownerId,
        status: "active",
      }),
    });
    expect(await personalGet.json()).toMatchObject({
      agent: expect.objectContaining({
        id: personalId,
        kind: "personal",
      }),
    });
    expect(await routineCreate.json()).toMatchObject({
      agent: expect.objectContaining({
        id: routineId,
        kind: "routine",
      }),
    });
    expect(await routines.json()).toMatchObject({
      agents: [{ id: routineId, kind: "routine" }],
    });
    expect(await routinePublish.json()).toMatchObject({
      agent: { id: routineId, revision: 2 },
    });
    expect(await personalPublish.json()).toMatchObject({
      agent: { id: personalId, revision: 2 },
    });
    expect(await personalVersions.json()).toMatchObject({
      items: [
        { id: personalAgent.activeVersion.id },
        { id: personalAgentUpdated.activeVersion.id },
      ],
      nextCursor: "next-versions",
    });
    expect(await routineVersions.json()).toMatchObject({
      items: [
        { id: routineAgent.activeVersion.id },
        { id: routineAgentPublished.activeVersion.id },
      ],
      nextCursor: null,
    });

    expect(await threadCreate.json()).toMatchObject({
      thread: expect.objectContaining({
        id: threadId,
        ownerId,
        kind: "assistant",
        title: "Daily check-in",
      }),
    });
    expect(await threadList.json()).toMatchObject({
      items: [{ id: threadId, title: "Daily check-in" }],
      nextCursor: "next-threads",
    });
    expect(await threadGet.json()).toMatchObject({
      thread: { id: threadId, title: "Daily check-in" },
    });
    expect(await threadUpdate.json()).toMatchObject({
      thread: { id: threadId, status: "archived", revision: 4 },
    });
    expect(await threadMarkRead.json()).toMatchObject({
      thread: { id: threadId, readThroughSequence: 4 },
    });
    expect(await turns.json()).toMatchObject({
      items: [{ id: turnId, sequence: 1, role: "user" }],
      nextCursor: null,
    });

    expect(await taskCreate.json()).toMatchObject({
      task: { id: taskId, title: "Prepare a report", status: "open" },
    });
    expect(await taskList.json()).toMatchObject({
      items: [
        {
          task: { id: taskId, title: "Prepare a report" },
          thread: expect.objectContaining({ id: threadId }),
        },
      ],
      nextCursor: "task-next",
    });
    expect(await taskGet.json()).toMatchObject({
      task: { id: taskId, status: "open" },
    });
    expect(await taskUpdate.json()).toMatchObject({
      task: { id: taskId, status: "completed", revision: 2 },
    });
    expect(await taskMarkRead.json()).toMatchObject({
      task: { id: taskId, unread: false },
    });
    expect(await taskRequests.json()).toMatchObject({
      inputRequests: [{ id: inputRequestId, status: "pending" }],
    });
    expect(await pendingRequests.json()).toMatchObject({
      inputRequests: [{ id: inputRequestId }],
    });
    expect(await responded.json()).toMatchObject({
      inputRequest: { id: inputRequestId, response: "Focus on customers" },
    });

    expect(agentRepository.createPersonal).toHaveBeenCalledWith({
      ownerId,
      displayName: "Personal",
      instructions: "Be calm.",
      defaultApprovalMode: "respect_tool_setting",
      callableRoutineIds: [],
    });
    expect(agentRepository.getPersonal).toHaveBeenCalledWith(ownerId);
    expect(agentRepository.createRoutine).toHaveBeenCalledWith({
      ownerId,
      displayName: "Routine",
      instructions: "Run tidy loops.",
      defaultApprovalMode: "autonomous",
      callableRoutineIds: [routineId],
    });
    expect(agentRepository.publishRoutine).toHaveBeenCalledWith({
      ownerId,
      agentId: routineId,
      displayName: "Routine",
      instructions: "Run tidy loops with checks.",
      defaultApprovalMode: "autonomous",
      callableRoutineIds: [],
      expectedRevision: 1,
      changeReason: undefined,
    });
    expect(agentRepository.publishPersonal).toHaveBeenCalledWith({
      ownerId,
      displayName: "Personal",
      instructions: "Be proactive.",
      defaultApprovalMode: "respect_tool_setting",
      callableRoutineIds: [],
      expectedRevision: 1,
      changeReason: undefined,
    });
    expect(agentRepository.listVersions).toHaveBeenCalledWith({
      ownerId,
      agentId: personalId,
      kind: "personal",
      cursor: "personal-cursor",
      limit: 2,
    });
    expect(agentRepository.listVersions).toHaveBeenCalledWith({
      ownerId,
      agentId: routineId,
      kind: "routine",
      cursor: undefined,
      limit: 1,
    });

    expect(threadRepository.createAssistant).toHaveBeenCalledWith({
      ownerId,
      agentId: personalId,
      title: "Daily check-in",
      approvalMode: "respect_tool_setting",
    });
    expect(threadRepository.list).toHaveBeenCalledWith({
      ownerId,
      kinds: ["assistant"],
      statuses: ["active"],
      pinned: true,
      unread: false,
      cursor: "thread-cursor",
      limit: 5,
    });
    expect(threadRepository.get).toHaveBeenCalledWith(ownerId, threadId);
    expect(threadRepository.update).toHaveBeenCalledWith({
      ownerId,
      threadId,
      expectedRevision: 3,
      title: "Daily check-in updated",
      status: "archived",
      pinned: true,
      approvalMode: "respect_tool_setting",
      forceUnread: true,
    });
    expect(threadRepository.markRead).toHaveBeenCalledWith({
      ownerId,
      threadId,
      throughSequence: 4,
    });
    expect(threadRepository.removeAssistant).toHaveBeenCalledWith({
      ownerId,
      threadId,
      expectedRevision: 4,
    });
    expect(turnRepository.list).toHaveBeenCalledWith({
      ownerId,
      threadId,
      cursor: undefined,
      limit: 10,
    });

    expect(taskRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId,
        title: "Prepare a report",
        description: "Quarterly summary",
        approvalMode: "respect_tool_setting",
        scheduledFor: new Date("2026-08-01T12:00:00.000Z"),
      }),
    );
    expect(taskRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceThreads: [threadId],
      }),
    );
    expect(taskRepository.list).toHaveBeenCalledWith({
      ownerId,
      statuses: ["open"],
      scheduledFrom: new Date("2026-08-01T00:00:00.000Z"),
      scheduledTo: new Date("2026-08-31T23:59:59.000Z"),
      unread: false,
      cursor: "task-cursor",
      limit: 25,
    });
    expect(taskRepository.get).toHaveBeenCalledWith(ownerId, taskId);
    expect(taskRepository.update).toHaveBeenCalledWith({
      ownerId,
      taskId,
      expectedRevision: 1,
      title: "Prepare a report",
      description: "Quarterly summary",
      status: "completed",
      scheduledFor: null,
    });
    expect(taskRepository.remove).toHaveBeenCalledWith({
      ownerId,
      taskId,
      expectedRevision: 2,
    });
    expect(taskRepository.markRead).toHaveBeenCalledWith({ ownerId, taskId });

    expect(inputRequestRepository.list).toHaveBeenCalledWith({
      ownerId,
      taskId,
    });
    expect(inputRequestRepository.listPending).toHaveBeenCalledWith(ownerId);
    expect(inputRequestRepository.answer).toHaveBeenCalledWith({
      ownerId,
      taskId,
      requestId: inputRequestId,
      response: "Focus on customers",
    });
  });

  it("validates strict request payloads and query parsing", async () => {
    const app = buildAgentApp({
      agentRepository: {
        createPersonal: vi.fn(),
        getPersonal: vi.fn(),
        createRoutine: vi.fn(),
        listRoutines: vi.fn(),
        publishRoutine: vi.fn(),
        listVersions: vi.fn(),
        publishPersonal: vi.fn(),
      } as unknown as AgentRepository,
      threadRepository: {
        createAssistant: vi.fn(),
        list: vi.fn(),
        get: vi.fn(),
        update: vi.fn(),
        markRead: vi.fn(),
        removeAssistant: vi.fn(),
      } as unknown as ThreadRepository,
      turnRepository: {
        list: vi.fn(),
      } as unknown as TurnRepository,
      taskRepository: {
        create: vi.fn(),
        list: vi.fn(),
        get: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
        markRead: vi.fn(),
      } as unknown as TaskRepository,
      inputRequestRepository: {
        list: vi.fn(),
        listPending: vi.fn(),
        answer: vi.fn(),
      } as unknown as InputRequestRepository,
    });

    const invalidPersonal = await app.request("/v1/agents/personal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "",
        instructions: "",
        defaultApprovalMode: "auto",
      }),
    });
    const invalidThreadList = await app.request(
      "/v1/threads?kind=bogus&limit=0",
    );
    const badTaskMarkRead = await app.request(
      `/v1/tasks/${deliveryTaskId}/mark-read`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response: "extra" }),
      },
    );
    const badMarkRead = await app.request(`/v1/threads/${threadId}/mark-read`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ throughSequence: "abc" }),
    });

    expect(invalidPersonal.status).toBe(400);
    expect(invalidThreadList.status).toBe(400);
    expect(badTaskMarkRead.status).toBe(400);
    expect(badMarkRead.status).toBe(400);
    expect(await invalidPersonal.json()).toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(await invalidThreadList.json()).toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(await badTaskMarkRead.json()).toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(await badMarkRead.json()).toMatchObject({ code: "INVALID_REQUEST" });
  });
});
