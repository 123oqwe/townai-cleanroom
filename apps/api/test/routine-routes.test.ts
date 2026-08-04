import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { z } from "zod";

import { asId } from "@town/contracts";
import type { AgentRepository, ThreadRepository } from "@town/agents";
import type { RoutineRepository, RoutineResultRepository } from "@town/routines";
import type { GoogleApiClient } from "@town/google";
import type { SessionRepository } from "@town/runtime";
import type { AuthVariables } from "../src/auth.js";
import {
  registerRoutineRoutes,
  type RoutineDependencies,
} from "../src/routine-routes.js";

const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");
const routineId = asId<"routine-schedule">("01900000-0000-7000-8000-000000000010");
const routineAgentId = asId<"agent">("01900000-0000-7000-8000-000000000011");
const routineAgentVersionId = asId<"agent-version">("01900000-0000-7000-8000-000000000012");
const routineRunId = asId<"integration-sync-run">("01900000-0000-7000-8000-000000000020");
const sessionRunId = asId<"session-run">("01900000-0000-7000-8000-000000000021");
const runtimeSessionId = asId<"runtime-session">("01900000-0000-7000-8000-000000000022");
const triggerId = asId<"routine-trigger">("01900000-0000-7000-8000-000000000030");
const webhookId = asId<"routine-webhook">("01900000-0000-7000-8000-000000000040");
const shareId = asId<"routine-share">("01900000-0000-7000-8000-000000000050");
const resultId = asId<"routine-result">("01900000-0000-7000-8000-000000000060");
const connectedAccountId = asId<"connected-account">(
  "01900000-0000-7000-8000-000000000070",
);

function withErrorMapping(app: Hono<{ Variables: AuthVariables }>) {
  app.onError((error, context) => {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return context.json({ code: "INVALID_REQUEST" }, 400);
    return context.json({ code: "INTERNAL_ERROR", detail: String(error) }, 500);
  });
}

function withIdentity(app: Hono<{ Variables: AuthVariables }>) {
  app.use("*", async (context, next) => {
    context.set("identity", { user: { id: ownerId, email: "owner@example.test" } });
    await next();
  });
}

function buildRoutineApp(dependencies: RoutineDependencies) {
  const app = new Hono<{ Variables: AuthVariables }>();
  withErrorMapping(app);
  withIdentity(app);
  registerRoutineRoutes(app, dependencies);
  return app;
}

describe("routine routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("covers routine lifecycle, triggers, runs, webhooks, shares, results and replay", async () => {
    const routine = {
      id: routineId,
      ownerId,
      agentId: routineAgentId,
      agentVersionId: routineAgentVersionId,
      name: "Daily routine",
      cron: "*/15 * * * *",
      timezone: "UTC",
      enabled: true,
      nextRunAt: new Date("2026-08-01T10:00:00.000Z"),
      lastRunAt: null,
      revision: 1,
      createdAt: new Date("2026-08-01T09:30:00.000Z"),
      updatedAt: new Date("2026-08-01T09:31:00.000Z"),
    };
    const routineUpdated = {
      ...routine,
      enabled: false,
      cron: "*/30 * * * *",
      nextRunAt: new Date("2026-08-01T11:00:00.000Z"),
      revision: 2,
    };
    const trigger = {
      id: triggerId,
      ownerId,
      routineScheduleId: routineId,
      kind: "webhook" as const,
      config: { event: "run" },
      enabled: true,
      revision: 1,
      createdAt: new Date("2026-08-01T10:05:00.000Z"),
      updatedAt: new Date("2026-08-01T10:05:00.000Z"),
    };
    const triggerUpdated = {
      ...trigger,
      enabled: false,
      revision: 2,
      config: { event: "run", filter: "urgent" },
      updatedAt: new Date("2026-08-01T10:10:00.000Z"),
    };
    const run = {
      id: routineRunId,
      ownerId,
      accountId: connectedAccountId,
      routineScheduleId: routineId,
      provider: "test",
      status: "queued" as const,
      triggerType: "manual" as const,
      triggerData: { input: "initial" },
      idempotencyKey: "manual-key-1",
      replayOfRunId: null,
      replayKey: null,
      cursor: {},
      errorCode: null,
      startedAt: null,
      finishedAt: null,
      runtimeRunId: sessionRunId,
      createdAt: new Date("2026-08-01T10:15:00.000Z"),
      updatedAt: new Date("2026-08-01T10:15:00.000Z"),
    };
    const replayRun = {
      ...run,
      id: asId<"integration-sync-run">("01900000-0000-7000-8000-000000000080"),
      status: "succeeded" as const,
      runtimeRunId: sessionRunId,
      startedAt: new Date("2026-08-01T10:16:00.000Z"),
      finishedAt: new Date("2026-08-01T10:17:00.000Z"),
    };
    const result = {
      id: resultId,
      ownerId,
      routineScheduleId: routineId,
      sessionId: runtimeSessionId,
      runId: sessionRunId,
      subject: "routine result",
      status: "completed" as const,
      output: { value: 1 },
      errorCode: null,
      errorMessage: null,
      documentId: null,
      notificationId: null,
      createdAt: new Date("2026-08-01T10:20:00.000Z"),
      updatedAt: new Date("2026-08-01T10:20:00.000Z"),
    };
    const webhook = {
      id: webhookId,
      ownerId,
      routineScheduleId: routineId,
      enabled: true,
      createdAt: new Date("2026-08-01T10:25:00.000Z"),
      updatedAt: new Date("2026-08-01T10:25:00.000Z"),
    };
    const share = {
      id: shareId,
      ownerId,
      routineScheduleId: routineId,
      expiresAt: null,
      revokedAt: null,
      createdAt: new Date("2026-08-01T10:26:00.000Z"),
    };
    const installed = {
      routine,
      sourceShareId: shareId,
    };
    const versions = {
      items: [
        {
          id: asId<"agent-version">("01900000-0000-7000-8000-000000000011"),
          agentId: routineAgentId,
          version: 1,
          snapshot: {
            displayName: "Daily",
            instructions: "do work",
            defaultApprovalMode: "autonomous" as const,
            callableRoutineIds: [],
          },
          changeReason: null,
          createdBy: "user" as const,
          createdAt: new Date("2026-08-01T09:20:00.000Z"),
        },
      ],
      nextCursor: "next-version",
    };

    const repository = {
      list: vi.fn().mockResolvedValue([routine]),
      get: vi.fn().mockResolvedValue(routine),
      ownsSchedule: vi.fn().mockResolvedValue(true),
      listRuns: vi.fn().mockResolvedValue([run]),
      listTriggers: vi.fn().mockResolvedValue([trigger]),
      createTrigger: vi.fn().mockResolvedValue(trigger),
      updateTrigger: vi.fn().mockResolvedValue(triggerUpdated),
      removeTrigger: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue(routine),
      update: vi.fn().mockResolvedValue(routineUpdated),
      remove: vi.fn().mockResolvedValue(undefined),
      queueTrigger: vi.fn().mockResolvedValue(run),
      replayRun: vi.fn().mockResolvedValue(replayRun),
      getRun: vi.fn().mockResolvedValue(run),
      getWebhook: vi.fn().mockResolvedValue(webhook),
      createWebhook: vi.fn().mockResolvedValue(webhook),
      setWebhookEnabled: vi.fn().mockResolvedValue({ ...webhook, enabled: false }),
      createShare: vi.fn().mockResolvedValue(share),
      revokeShare: vi.fn().mockResolvedValue(undefined),
      installShare: vi.fn().mockResolvedValue(installed),
    } as unknown as RoutineRepository;
    const results = {
      listForSession: vi.fn().mockResolvedValue([result]),
      getForRun: vi.fn().mockResolvedValue(result),
    } as unknown as RoutineResultRepository;
    const agents = {
      listVersions: vi.fn().mockResolvedValue(versions),
      getRoutine: vi.fn().mockResolvedValue({
        id: routineAgentId,
        ownerId,
        kind: "routine",
        status: "active",
        revision: 1,
        activeVersion: {
          id: routineAgentVersionId,
          agentId: routineAgentId,
          version: 1,
          snapshot: {
            displayName: "Daily",
            instructions: "do work",
            defaultApprovalMode: "autonomous",
            callableRoutineIds: [],
          },
          changeReason: null,
          createdBy: "user",
          createdAt: new Date("2026-08-01T09:20:00.000Z"),
        },
        createdAt: new Date("2026-08-01T09:20:00.000Z"),
        updatedAt: new Date("2026-08-01T09:20:00.000Z"),
      }),
    } as unknown as AgentRepository;
    const threads = {
      createTask: vi.fn(),
    } as unknown as ThreadRepository;
    const sessions = {
      submitMessage: vi.fn(),
    } as unknown as SessionRepository;
    const app = buildRoutineApp({
      repository,
      results,
      google: undefined as unknown as GoogleApiClient,
      agents,
      threads,
      sessions,
    });

    const routineTemplates = await app.request("/v1/routine-templates");
    const routineList = await app.request("/v1/routines");
    const routineVersions = await app.request(
      `/v1/routines/${routineId}/versions?limit=2&cursor=v1`,
    );
    const createRoutine = await app.request("/v1/routines", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: routineAgentId,
        agentVersionId: routineAgentVersionId,
        name: "Daily routine",
        cron: "*/20 * * * *",
        nextRunAt: "2026-08-01T12:00:00.000Z",
      }),
    });
    const listRuns = await app.request(`/v1/routines/${routineId}/runs?limit=10`);
    const updateRoutine = await app.request(`/v1/routines/${routineId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: routineAgentId,
        agentVersionId: routineAgentVersionId,
        expectedRevision: 1,
        name: "Daily routine",
        cron: "*/30 * * * *",
        timezone: "UTC",
        nextRunAt: "2026-08-01T11:00:00.000Z",
        enabled: false,
      }),
    });
    const deleteRoutine = await app.request(
      `/v1/routines/${routineId}?expectedRevision=2`,
      { method: "DELETE" },
    );
    const createRunByQueue = await app.request(`/v1/routines/${routineId}/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "manual-idem",
      },
      body: JSON.stringify({ input: "trigger now" }),
    });
    const triggerRoutine = await app.request(`/v1/routines/${routineId}/trigger`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "trigger-idem",
      },
      body: JSON.stringify({ kind: "webhook", data: { event: "x" } }),
    });
    const listTriggers = await app.request(`/v1/routines/${routineId}/triggers`);
    const createTrigger = await app.request(`/v1/routines/${routineId}/triggers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "webhook",
        config: { event: "run" },
        enabled: true,
      }),
    });
    const patchTrigger = await app.request(`/v1/routine-triggers/${triggerId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 1,
        config: { event: "run", filter: "urgent" },
        enabled: false,
      }),
    });
    const deleteTrigger = await app.request(
      `/v1/routine-triggers/${triggerId}?expectedRevision=1`,
      { method: "DELETE" },
    );
    const routineRuns = await app.request(`/v1/routine-runs/${routineRunId}`);
    const rerun = await app.request(
      `/v1/routine-runs/${routineRunId}/replay`,
      {
        method: "POST",
        headers: { "Idempotency-Key": "replay-id" },
      },
    );
    const routineResult = await app.request(
      `/v1/routine-results?sessionId=${runtimeSessionId}&limit=2`,
    );
    const webhookGet = await app.request(`/v1/routines/${routineId}/webhook`);
    const webhookPost = await app.request(`/v1/routines/${routineId}/webhook`, {
      method: "POST",
    });
    const webhookPatch = await app.request(`/v1/routines/${routineId}/webhook`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    const createShare = await app.request(`/v1/routines/${routineId}/shares`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expiresAt: null }),
    });
    const installShare = await app.request("/v1/routines/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "rtnshare_valid_token_12345",
        nextRunAt: "2026-08-02T00:00:00.000Z",
      }),
    });
    const revokeShare = await app.request(
      `/v1/routines/shares/${shareId}`,
      { method: "DELETE" },
    );

    expect(routineTemplates.status).toBe(200);
    expect(routineList.status).toBe(200);
    expect(routineVersions.status).toBe(200);
    expect(createRoutine.status).toBe(201);
    expect(listRuns.status).toBe(200);
    expect(updateRoutine.status).toBe(200);
    expect(deleteRoutine.status).toBe(204);
    expect(createRunByQueue.status).toBe(202);
    expect(triggerRoutine.status).toBe(202);
    expect(listTriggers.status).toBe(200);
    expect(createTrigger.status).toBe(201);
    expect(patchTrigger.status).toBe(200);
    expect(deleteTrigger.status).toBe(204);
    expect(routineRuns.status).toBe(200);
    expect(rerun.status).toBe(202);
    expect(routineResult.status).toBe(200);
    expect(webhookGet.status).toBe(200);
    expect(webhookPost.status).toBe(201);
    expect(webhookPatch.status).toBe(200);
    expect(createShare.status).toBe(201);
    expect(installShare.status).toBe(201);
    expect(revokeShare.status).toBe(204);

    expect(await routineTemplates.json()).toMatchObject({
      templates: expect.any(Array),
    });
    expect(await routineList.json()).toMatchObject({
      routines: [{ id: routineId, name: "Daily routine" }],
    });
    expect(await routineVersions.json()).toMatchObject({
      items: [{ id: asId<"agent-version">("01900000-0000-7000-8000-000000000011") }],
      nextCursor: "next-version",
    });
    expect(await createRoutine.json()).toMatchObject({
      routine: { id: routineId, name: "Daily routine" },
    });
    expect(await listRuns.json()).toMatchObject({
      runs: [{ id: routineRunId, status: "queued" }],
    });
    expect(await updateRoutine.json()).toMatchObject({
      routine: { id: routineId, revision: 2, enabled: false },
    });
    expect(await createRunByQueue.json()).toMatchObject({
      run: { id: routineRunId },
    });
    expect(await triggerRoutine.json()).toMatchObject({
      run: { id: routineRunId },
    });
    expect(await listTriggers.json()).toMatchObject({
      triggers: [{ id: triggerId, kind: "webhook" }],
    });
    expect(await createTrigger.json()).toMatchObject({
      trigger: { id: triggerId, enabled: true },
    });
    expect(await patchTrigger.json()).toMatchObject({
      trigger: { id: triggerId, revision: 2, enabled: false },
    });
    expect(await routineRuns.json()).toMatchObject({
      run: { id: routineRunId },
      result: {
        id: resultId,
        subject: "routine result",
      },
    });
    expect(await rerun.json()).toMatchObject({
      run: { id: asId<"integration-sync-run">("01900000-0000-7000-8000-000000000080") },
    });
    expect(await routineResult.json()).toMatchObject({
      results: [{ id: resultId, subject: "routine result" }],
    });
    expect(await webhookGet.json()).toMatchObject({
      webhook: { id: webhookId, enabled: true },
    });
    expect(await webhookPost.json()).toMatchObject({
      id: webhookId,
      routineScheduleId: routineId,
    });
    expect(await webhookPatch.json()).toMatchObject({
      webhook: { id: webhookId, enabled: false },
    });
    expect(await createShare.json()).toMatchObject({
      id: shareId,
      routineScheduleId: routineId,
    });
    expect(await installShare.json()).toMatchObject({
      sourceShareId: shareId,
      routine: { id: routineId },
    });

    expect(repository.list).toHaveBeenCalledWith(ownerId);
    expect(repository.get).toHaveBeenCalledWith(ownerId, routineId);
    expect(repository.listRuns).toHaveBeenCalledWith(ownerId, routineId, 10);
    expect(repository.create).toHaveBeenCalledWith({
      agentId: routineAgentId,
      agentVersionId: routineAgentVersionId,
      ownerId,
      name: "Daily routine",
      cron: "*/20 * * * *",
      timezone: "UTC",
      nextRunAt: new Date("2026-08-01T12:00:00.000Z"),
      enabled: true,
    });
    expect(repository.update).toHaveBeenCalledWith({
      agentId: routineAgentId,
      agentVersionId: routineAgentVersionId,
      ownerId,
      id: routineId,
      expectedRevision: 1,
      name: "Daily routine",
      cron: "*/30 * * * *",
      timezone: "UTC",
      nextRunAt: new Date("2026-08-01T11:00:00.000Z"),
      enabled: false,
    });
    expect(repository.remove).toHaveBeenCalledWith(ownerId, routineId, 2);
    expect(repository.ownsSchedule).toHaveBeenCalledWith(ownerId, routineId);
    expect(repository.queueTrigger).toHaveBeenCalledWith(
      ownerId,
      routineId,
      "manual",
      { input: "trigger now" },
      "manual-idem",
    );
    expect(repository.queueTrigger).toHaveBeenCalledWith(
      ownerId,
      routineId,
      "webhook",
      { event: "x" },
      "trigger-idem",
    );
    expect(repository.getRun).toHaveBeenCalledWith(ownerId, routineRunId);
    expect(repository.replayRun).toHaveBeenCalledWith(ownerId, routineRunId, "replay-id");
    expect(repository.createTrigger).toHaveBeenCalledWith({
      ownerId,
      routineScheduleId: routineId,
      kind: "webhook",
      config: { event: "run" },
      enabled: true,
    });
    expect(repository.updateTrigger).toHaveBeenCalledWith({
      ownerId,
      triggerId,
      expectedRevision: 1,
      config: { event: "run", filter: "urgent" },
      enabled: false,
    });
    expect(repository.removeTrigger).toHaveBeenCalledWith(
      ownerId,
      triggerId,
      1,
    );
    expect(repository.getWebhook).toHaveBeenCalledWith(ownerId, routineId);
    expect(repository.createWebhook).toHaveBeenCalledWith(ownerId, routineId);
    expect(repository.setWebhookEnabled).toHaveBeenCalledWith(ownerId, routineId, false);
    expect(repository.createShare).toHaveBeenCalledWith({
      ownerId,
      routineScheduleId: routineId,
      expiresAt: null,
    });
    expect(repository.revokeShare).toHaveBeenCalledWith(ownerId, shareId);
    expect(repository.installShare).toHaveBeenCalledWith({
      ownerId,
      token: "rtnshare_valid_token_12345",
      nextRunAt: new Date("2026-08-02T00:00:00.000Z"),
      enabled: true,
    });
    expect(agents.listVersions).toHaveBeenCalledWith({
      ownerId,
      agentId: routineAgentId,
      kind: "routine",
      cursor: "v1",
      limit: 2,
    });
    expect(results.listForSession).toHaveBeenCalledWith(
      ownerId,
      runtimeSessionId,
      2,
    );
    expect(results.getForRun).toHaveBeenCalledWith(ownerId, sessionRunId);
  });

  it("validates request contracts and 503 branches for optional deps", async () => {
    const app = buildRoutineApp({
      repository: {
        list: vi.fn().mockResolvedValue([]),
        get: vi.fn(),
        ownsSchedule: vi.fn(),
        listRuns: vi.fn(),
        listTriggers: vi.fn(),
        createTrigger: vi.fn(),
        updateTrigger: vi.fn(),
        removeTrigger: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
        queueTrigger: vi.fn(),
        replayRun: vi.fn(),
        getRun: vi.fn(),
        getWebhook: vi.fn(),
        createWebhook: vi.fn(),
        setWebhookEnabled: vi.fn(),
        createShare: vi.fn(),
        revokeShare: vi.fn(),
        installShare: vi.fn(),
      } as unknown as RoutineRepository,
      results: undefined,
      google: undefined as unknown as GoogleApiClient,
      agents: undefined,
      threads: undefined as unknown as ThreadRepository,
      sessions: undefined as unknown as SessionRepository,
    });
    const invalidCron = await app.request("/v1/routines", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: routineAgentId,
        agentVersionId: routineAgentVersionId,
        name: "",
        cron: "*/10 * * * * *",
        nextRunAt: "2026-08-01T12:00:00.000Z",
      }),
    });
    const versionsUnavailable = await app.request(
      `/v1/routines/${routineId}/versions?limit=2`,
    );
    const noRoutineResults = await app.request(
      `/v1/routine-results?sessionId=${runtimeSessionId}`,
    );
    const noWebhookHeader = await app.request(`/v1/routines/${routineId}/webhook`, {
      method: "GET",
    });
    expect(invalidCron.status).toBe(400);
    expect(versionsUnavailable.status).toBe(503);
    expect(noRoutineResults.status).toBe(404);
    expect(await invalidCron.json()).toMatchObject({ code: "INVALID_REQUEST" });
    expect(await versionsUnavailable.json()).toMatchObject({
      error: "AGENTS_NOT_CONFIGURED",
    });
    const missingRoutineResultsBody = await noRoutineResults.text();
    expect(missingRoutineResultsBody).toMatch(/Not Found/);
    expect(noWebhookHeader.status).toBe(404);
  });
});
