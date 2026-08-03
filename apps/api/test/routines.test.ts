import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Sql } from "postgres";

import type { AuthVariables } from "../src/auth.js";
import {
  registerRoutineRoutes,
  registerRoutineShareRoutes,
  registerRoutineWebhookRoutes,
} from "../src/routine-routes.js";
import type {
  RoutineRepository,
  RoutineResultRepository,
  RoutineSchedule,
} from "@town/routines";
import { asId } from "@town/contracts";
import type { AgentRepository, ThreadRepository } from "@town/agents";
import type { SessionRepository } from "@town/runtime";
import type { GoogleApiClient } from "@town/google";

const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");
const agentId = "01900000-0000-7000-8000-000000000002";
const agentVersionId = "01900000-0000-7000-8000-000000000003";

function appWith(
  repository: RoutineRepository,
  extras: {
    sql?: Sql;
    agents?: AgentRepository;
    threads?: ThreadRepository;
    sessions?: SessionRepository;
    results?: RoutineResultRepository;
    google?: GoogleApiClient;
  } = {},
): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (context, next) => {
    context.set("identity", {
      user: { id: ownerId },
    } as AuthVariables["identity"]);
    await next();
  });
  registerRoutineRoutes(app, { repository, ...extras });
  registerRoutineWebhookRoutes(app, { repository });
  registerRoutineShareRoutes(app, { repository });
  return app;
}

describe("routine routes", () => {
  it("lists owner schedules and creates a validated schedule", async () => {
    const created: RoutineSchedule = {
      id: asId<"routine-schedule">("01900000-0000-7000-8000-000000000004"),
      ownerId,
      agentId: asId<"agent">(agentId),
      agentVersionId: asId<"agent-version">(agentVersionId),
      name: "Morning sync",
      cron: "0 9 * * 1-5",
      timezone: "Asia/Shanghai",
      enabled: true,
      nextRunAt: new Date("2026-08-03T01:00:00.000Z"),
      lastRunAt: null,
      revision: 1,
      createdAt: new Date("2026-08-02T00:00:00.000Z"),
      updatedAt: new Date("2026-08-02T00:00:00.000Z"),
    };
    const repository = {
      list: async (requestedOwner: typeof ownerId) => {
        expect(requestedOwner).toBe(ownerId);
        return [created];
      },
      create: async (input: Record<string, unknown>) => {
        expect(input["ownerId"]).toBe(ownerId);
        expect(input["nextRunAt"]).toBeInstanceOf(Date);
        return created;
      },
    } as unknown as RoutineRepository;
    const app = appWith(repository);

    const list = await app.request("http://town.test/v1/routines");
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { routines: RoutineSchedule[] };
    expect(listBody.routines).toHaveLength(1);

    const response = await app.request("http://town.test/v1/routines", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId,
        agentVersionId,
        name: "Morning sync",
        cron: "0 9 * * 1-5",
        timezone: "Asia/Shanghai",
        nextRunAt: "2026-08-03T01:00:00.000Z",
      }),
    });
    expect(response.status).toBe(201);
    const responseBody = (await response.json()) as {
      routine: RoutineSchedule;
    };
    expect(responseBody.routine.name).toBe("Morning sync");
  });

  it("installs a stock routine atomically across agent, version, and schedule", async () => {
    const statements: string[] = [];
    const transaction = Object.assign(
      async (strings: TemplateStringsArray) => {
        statements.push(strings.join(" ").replace(/\s+/g, " ").trim());
        return [];
      },
      { json: (value: unknown) => JSON.stringify(value) },
    ) as unknown as Sql;
    const sql = {
      begin: async (callback: (tx: Sql) => Promise<unknown>) =>
        callback(transaction),
    } as unknown as Sql;
    const agent = {
      id: asId<"agent">("01900000-0000-7000-8000-000000000010"),
      activeVersion: { id: asId<"agent-version">(agentVersionId) },
    };
    const routine = { id: asId<"routine-schedule">(agentId) };
    const repository = {
      get: vi.fn().mockResolvedValue(routine),
    } as unknown as RoutineRepository;
    const agents = {
      getRoutine: vi.fn().mockResolvedValue(agent),
    } as unknown as AgentRepository;
    const app = appWith(repository, { sql, agents });

    const response = await app.request(
      "http://town.test/v1/routine-templates/morning-briefing/install",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cron: "0 8 * * 1-5",
          timezone: "Asia/Shanghai",
          nextRunAt: "2026-08-04T00:00:00.000Z",
        }),
      },
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      template: { id: "morning-briefing" },
      agent,
      routine,
    });
    expect(statements).toHaveLength(5);
    expect(statements.slice(1)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("insert into agents"),
        expect.stringContaining("insert into agent_versions"),
        expect.stringContaining("update agents"),
        expect.stringContaining("insert into routine_schedules"),
      ]),
    );
  });

  it("accepts authenticated webhook payloads and preserves idempotency", async () => {
    const repository = {
      deliverWebhook: async (
        routineId: string,
        secret: string,
        key: string,
        payload: Record<string, unknown>,
      ) => {
        expect(routineId).toBe(agentId);
        expect(secret).toBe("whsec_test_secret_123456");
        expect(key).toBe("event-1");
        expect(payload).toEqual({ event: "ping" });
        return {
          runId: asId<"integration-sync-run">(agentVersionId),
          duplicate: true,
        };
      },
    } as unknown as RoutineRepository;
    const app = appWith(repository);
    const response = await app.request(
      `http://town.test/v1/routine-webhooks/${agentId}`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer whsec_test_secret_123456",
          "content-type": "application/json",
          "x-town-idempotency-key": "event-1",
        },
        body: JSON.stringify({ event: "ping" }),
      },
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ duplicate: true });
  });

  it("rejects malformed or oversized webhook payloads before repository access", async () => {
    const deliverWebhook = vi.fn();
    const app = appWith({ deliverWebhook } as unknown as RoutineRepository);
    const malformed = await app.request(
      `http://town.test/v1/routine-webhooks/${agentId}`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer whsec_test_secret_123456",
          "content-type": "application/json",
          "x-town-idempotency-key": "event-bad-json",
        },
        body: "{not-json",
      },
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "INVALID_JSON" });

    const oversized = await app.request(
      `http://town.test/v1/routine-webhooks/${agentId}`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer whsec_test_secret_123456",
          "content-type": "text/plain",
          "x-town-idempotency-key": "event-large",
        },
        body: "x".repeat(256_001),
      },
    );
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ error: "PAYLOAD_TOO_LARGE" });
    expect(deliverWebhook).not.toHaveBeenCalled();
  });

  it("replays a terminal routine run through an idempotent endpoint", async () => {
    const replayed = {
      id: asId<"integration-sync-run">("01900000-0000-7000-8000-000000000018"),
      status: "queued",
    };
    const repository = {
      replayRun: async (
        requestedOwner: typeof ownerId,
        runId: string,
        key: string,
      ) => {
        expect(requestedOwner).toBe(ownerId);
        expect(runId).toBe(agentVersionId);
        expect(key).toBe("replay-1");
        return replayed;
      },
    } as unknown as RoutineRepository;
    const app = appWith(repository);
    const response = await app.request(
      `http://town.test/v1/routine-runs/${agentVersionId}/replay`,
      { method: "POST", headers: { "idempotency-key": "replay-1" } },
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ run: replayed });
  });

  it("returns a routine run with its persisted result", async () => {
    const runId = asId<"integration-sync-run">(agentVersionId);
    const runtimeRunId = asId<"session-run">(
      "01900000-0000-7000-8000-000000000021",
    );
    const run = { id: runId, runtimeRunId, status: "succeeded" };
    const result = {
      runId: runtimeRunId,
      status: "completed",
      subject: "Briefing",
    };
    const repository = {
      getRun: vi.fn().mockResolvedValue(run),
    } as unknown as RoutineRepository;
    const results = {
      getForRun: vi.fn().mockResolvedValue(result),
    } as unknown as RoutineResultRepository;
    const app = appWith(repository, { results });
    const response = await app.request(
      `http://town.test/v1/routine-runs/${runId}`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ run, result });
    expect(results.getForRun).toHaveBeenCalledWith(ownerId, runtimeRunId);
  });

  it("ingests real Gmail messages into the configured incoming-email trigger", async () => {
    const accountId = asId<"connected-account">(agentVersionId);
    const routineId = asId<"routine-schedule">(agentId);
    const queued = {
      id: asId<"integration-sync-run">("01900000-0000-7000-8000-000000000022"),
      triggerType: "incoming_email",
    };
    const repository = {
      listTriggers: vi.fn().mockResolvedValue([
        {
          enabled: true,
          kind: "incoming_email",
          config: { query: "from:alerts@example.com" },
        },
      ]),
      queueTrigger: vi.fn().mockResolvedValue(queued),
    } as unknown as RoutineRepository;
    const google = {
      gmailSearch: vi.fn().mockResolvedValue({
        messages: [{ id: "msg-1", threadId: "thread-1", labelIds: ["INBOX"] }],
        nextPageToken: "next-1",
      }),
      gmailGetMessage: vi.fn().mockResolvedValue({
        id: "msg-1",
        threadId: "thread-1",
        labelIds: ["INBOX", "UNREAD"],
        payload: { headers: [{ name: "Subject", value: "Alert" }] },
      }),
    } as unknown as GoogleApiClient;
    const app = appWith(repository, { google });
    const response = await app.request(
      `http://town.test/v1/routines/${routineId}/ingest/email`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId }),
      },
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      query: "from:alerts@example.com",
      nextPageToken: "next-1",
      runs: [queued],
    });
    expect(google.gmailSearch).toHaveBeenCalledWith({
      ownerId,
      accountId,
      query: "from:alerts@example.com",
      maxResults: 10,
    });
    expect(repository.queueTrigger).toHaveBeenCalledWith(
      ownerId,
      routineId,
      "incoming_email",
      expect.objectContaining({ messageId: "msg-1", accountId }),
      `gmail:${accountId}:msg-1`,
      accountId,
    );
  });

  it("queues manual runs through the unified trigger repository", async () => {
    const queued = {
      id: asId<"integration-sync-run">("01900000-0000-7000-8000-000000000019"),
      status: "queued",
      triggerType: "manual",
    };
    const repository = {
      queueTrigger: async (
        requestedOwner: typeof ownerId,
        routineId: string,
        kind: string,
        data: Record<string, unknown>,
        key: string,
      ) => {
        expect(requestedOwner).toBe(ownerId);
        expect(routineId).toBe(agentId);
        expect(kind).toBe("manual");
        expect(data).toEqual({ input: "run now" });
        expect(key).toBe("manual-request-1");
        return queued;
      },
    } as unknown as RoutineRepository;
    const app = appWith(repository);
    const response = await app.request(
      `http://town.test/v1/routines/${agentId}/run`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "manual-request-1",
        },
        body: JSON.stringify({ input: "run now" }),
      },
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ run: queued });
  });

  it("queues calendar triggers with a required idempotency key", async () => {
    const queued = {
      id: asId<"integration-sync-run">("01900000-0000-7000-8000-000000000020"),
      status: "queued",
      triggerType: "calendar",
    };
    const repository = {
      queueTrigger: async (
        _owner: typeof ownerId,
        _routine: string,
        kind: string,
        data: Record<string, unknown>,
        key: string,
      ) => {
        expect(kind).toBe("calendar");
        expect(data).toEqual({ eventId: "event-1" });
        expect(key).toBe("calendar-event-1");
        return queued;
      },
    } as unknown as RoutineRepository;
    const app = appWith(repository);
    const response = await app.request(
      `http://town.test/v1/routines/${agentId}/trigger`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "calendar-event-1",
        },
        body: JSON.stringify({
          kind: "calendar",
          data: { eventId: "event-1" },
        }),
      },
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ run: queued });
  });

  it("returns a public routine share and hides revoked tokens", async () => {
    const repository = {
      getPublicShare: vi.fn().mockResolvedValue({
        shareId: asId<"routine-share">(agentVersionId),
        routine: {
          id: asId<"routine-schedule">(agentId),
          name: "Shared briefing",
          cron: "0 9 * * 1-5",
          timezone: "UTC",
          enabled: true,
        },
        version: {
          id: asId<"agent-version">(agentVersionId),
          version: 1,
          snapshot: {
            displayName: "Briefing",
            instructions: "test",
            defaultApprovalMode: "require_approval",
            callableRoutineIds: [],
          },
        },
        expiresAt: new Date("2099-01-01T00:00:00Z"),
      }),
    } as unknown as RoutineRepository;
    const app = appWith(repository);
    const response = await app.request(
      "http://town.test/v1/routine-shares/rtnshare_test_token",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      share: { routine: { name: "Shared briefing" } },
    });
    expect(repository.getPublicShare).toHaveBeenCalledWith(
      "rtnshare_test_token",
    );

    const page = await app.request(
      "http://town.test/v1/routine-shares/rtnshare_test_token",
      { headers: { accept: "text/html" } },
    );
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    const html = await page.text();
    expect(html).toContain("Shared routine");
    expect(html).toContain("Briefing");
    expect(html).not.toContain("01900000-0000-7000-8000-000000000001");
  });

  it("installs a shared Routine using server-derived owner identity", async () => {
    const routine = {
      id: asId<"routine-schedule">(agentVersionId),
      ownerId,
      agentId: asId<"agent">(agentId),
      agentVersionId: asId<"agent-version">(agentVersionId),
      name: "Copied briefing",
      cron: "0 9 * * 1-5",
      timezone: "UTC",
      enabled: true,
      nextRunAt: new Date("2026-08-04T01:00:00Z"),
      lastRunAt: null,
      revision: 1,
      createdAt: new Date("2026-08-03T00:00:00Z"),
      updatedAt: new Date("2026-08-03T00:00:00Z"),
    };
    const repository = {
      installShare: vi
        .fn()
        .mockImplementation(async (input: { ownerId: string }) => {
          expect(input.ownerId).toBe(ownerId);
          return { routine, sourceShareId: asId<"routine-share">(agentId) };
        }),
    } as unknown as RoutineRepository;
    const app = appWith(repository);
    const response = await app.request("http://town.test/v1/routines/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "rtnshare_test_token_123456",
        nextRunAt: "2026-08-04T01:00:00.000Z",
      }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      routine: { name: "Copied briefing" },
    });
  });

  it("turns a manual routine trigger into a durable session submission", async () => {
    const routine = {
      id: asId<"routine-schedule">("01900000-0000-7000-8000-000000000004"),
      ownerId,
      agentId: asId<"agent">(agentId),
      agentVersionId: asId<"agent-version">(agentVersionId),
      name: "Briefing",
    };
    const repository = {
      get: vi.fn().mockResolvedValue(routine),
    } as unknown as RoutineRepository;
    const agent = {
      id: routine.agentId,
      activeVersion: { snapshot: { defaultApprovalMode: "autonomous" } },
    };
    const thread = {
      id: asId<"thread">("01900000-0000-7000-8000-000000000005"),
    };
    const submitMessage = vi.fn().mockResolvedValue({ queued: true });
    const app = appWith(repository, {
      agents: {
        getRoutine: vi.fn().mockResolvedValue(agent),
      } as unknown as AgentRepository,
      threads: {
        createTask: vi.fn().mockResolvedValue(thread),
      } as unknown as ThreadRepository,
      sessions: { submitMessage } as unknown as SessionRepository,
    });
    const response = await app.request(
      `http://town.test/v1/routines/${routine.id}/run`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "briefing-1",
        },
        body: JSON.stringify({ input: "prepare the briefing" }),
      },
    );
    expect(response.status).toBe(202);
    expect(submitMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: thread.id,
        text: "prepare the briefing",
        idempotencyKey: "briefing-1",
      }),
    );
  });
});
