import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

import type { AuthVariables } from "../src/auth.js";
import {
  registerRoutineRoutes,
  registerRoutineShareRoutes,
  registerRoutineWebhookRoutes,
} from "../src/routine-routes.js";
import type { RoutineRepository, RoutineSchedule } from "@town/routines";
import { asId } from "@town/contracts";
import type { AgentRepository, ThreadRepository } from "@town/agents";
import type { SessionRepository } from "@town/runtime";

const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");
const agentId = "01900000-0000-7000-8000-000000000002";
const agentVersionId = "01900000-0000-7000-8000-000000000003";

function appWith(
  repository: RoutineRepository,
  extras: {
    agents?: AgentRepository;
    threads?: ThreadRepository;
    sessions?: SessionRepository;
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

  it("accepts authenticated webhook payloads and preserves idempotency", async () => {
    const repository = {
      deliverWebhook: async (
        secret: string,
        key: string,
        payload: Record<string, unknown>,
      ) => {
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
