import { describe, expect, it, vi } from "vitest";

import { newId } from "@town/contracts";

import { TownApiError, TownClient } from "../src/index.js";

type FetchCall = {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
};

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const status = init.status ?? 200;
  if (body === null || status === 204)
    return new Response(null, {
      status,
      headers: { ...(init.headers ?? {}) },
    });
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function makeClient(
  responses: Response[],
  calls: FetchCall[],
  options: { token?: string } = {},
): TownClient {
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({
      url,
      init: {
        ...init,
        headers: (init.headers ?? {}) as Record<string, string>,
      },
    });
    const response = responses.shift();
    if (response === undefined) throw new Error("no mock response queued");
    return response;
  }) as unknown as typeof globalThis.fetch;
  return new TownClient({
    baseUrl: "https://api.example.test",
    ...(options.token === undefined ? {} : { token: options.token }),
    fetch: fetchImpl,
  });
}

function routineFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: newId<"routine-schedule">(),
    ownerId: newId<"user">(),
    agentId: newId<"agent">(),
    agentVersionId: newId<"agent-version">(),
    name: "Morning Briefing",
    cron: "0 8 * * *",
    timezone: "UTC",
    enabled: true,
    nextRunAt: "2026-08-07T08:00:00.000Z",
    lastRunAt: null,
    revision: 1,
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("TownClient routines namespace", () => {
  it("lists routines via GET /v1/routines", async () => {
    const routine = routineFixture();
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse({ routines: [routine] })], calls, {
      token: "t",
    });

    const result = await client.routines.list();

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("Morning Briefing");
    expect(calls[0]?.url).toBe("https://api.example.test/v1/routines");
    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[0]?.init.headers["Authorization"]).toBe("Bearer t");
  });

  it("gets a single routine by listing and filtering", async () => {
    const target = routineFixture();
    const other = routineFixture({ name: "Other" });
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ routines: [other, target] })],
      calls,
      { token: "t" },
    );

    const result = await client.routines.get(target.id);

    expect(result.id).toBe(target.id);
    expect(calls[0]?.url).toBe("https://api.example.test/v1/routines");
  });

  it("creates a routine via POST /v1/routines", async () => {
    const routine = routineFixture();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ routine }, { status: 201 })],
      calls,
      { token: "t" },
    );

    const result = await client.routines.create({
      agentId: routine.agentId,
      agentVersionId: routine.agentVersionId,
      name: "Morning Briefing",
      cron: "0 8 * * *",
      nextRunAt: "2026-08-07T08:00:00.000Z",
    });

    expect(result.name).toBe("Morning Briefing");
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(calls[0]?.init.body as string).name).toBe(
      "Morning Briefing",
    );
  });

  it("updates a routine via PATCH /v1/routines/:id", async () => {
    const routine = routineFixture({ revision: 2 });
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse({ routine })], calls, {
      token: "t",
    });

    const result = await client.routines.update(routine.id, {
      agentId: routine.agentId,
      agentVersionId: routine.agentVersionId,
      name: "Updated",
      cron: "0 9 * * *",
      timezone: "UTC",
      nextRunAt: "2026-08-07T09:00:00.000Z",
      enabled: true,
      expectedRevision: 1,
    });

    expect(result.revision).toBe(2);
    expect(calls[0]?.init.method).toBe("PATCH");
    expect(calls[0]?.url).toBe(
      `https://api.example.test/v1/routines/${routine.id}`,
    );
  });

  it("deletes a routine with expectedRevision query", async () => {
    const id = newId<"routine-schedule">();
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse(null, { status: 204 })], calls, {
      token: "t",
    });

    await client.routines.delete(id, 3);

    expect(calls[0]?.init.method).toBe("DELETE");
    expect(calls[0]?.url).toBe(
      `https://api.example.test/v1/routines/${id}?expectedRevision=3`,
    );
  });

  it("lists versions via GET /v1/routines/:id/versions", async () => {
    const id = newId<"routine-schedule">();
    const versions = {
      items: [
        {
          id: newId<"agent-version">(),
          agentId: newId<"agent">(),
          version: 1,
          snapshot: {
            displayName: "Morning Briefing",
            instructions: "Prepare briefing",
            defaultApprovalMode: "require_approval",
            callableRoutineIds: [],
          },
          changeReason: null,
          createdBy: "system",
          createdAt: "2026-08-06T00:00:00.000Z",
        },
      ],
      nextCursor: null,
    };
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse(versions)], calls, { token: "t" });

    const result = await client.routines.versions(id, 20);

    expect(result.items).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      `https://api.example.test/v1/routines/${id}/versions?limit=20`,
    );
  });

  it("lists runs via GET /v1/routines/:id/runs", async () => {
    const id = newId<"routine-schedule">();
    const run = {
      id: newId<"integration-sync-run">(),
      ownerId: newId<"user">(),
      accountId: newId<"connected-account">(),
      routineScheduleId: id,
      provider: "manual",
      status: "succeeded",
      triggerType: "manual",
      triggerData: {},
      idempotencyKey: "k1",
      replayOfRunId: null,
      replayKey: null,
      cursor: {},
      errorCode: null,
      startedAt: null,
      finishedAt: null,
      runtimeRunId: null,
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z",
    };
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse({ runs: [run] })], calls, {
      token: "t",
    });

    const result = await client.routines.runs.list(id, 8);

    expect(result).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      `https://api.example.test/v1/routines/${id}/runs?limit=8`,
    );
  });

  it("lists triggers via GET /v1/routines/:id/triggers", async () => {
    const id = newId<"routine-schedule">();
    const trigger = {
      id: newId<"routine-trigger">(),
      ownerId: newId<"user">(),
      routineScheduleId: id,
      kind: "webhook",
      config: {},
      enabled: true,
      revision: 1,
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z",
    };
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse({ triggers: [trigger] })], calls, {
      token: "t",
    });

    const result = await client.routines.triggers.list(id);

    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("webhook");
    expect(calls[0]?.url).toBe(
      `https://api.example.test/v1/routines/${id}/triggers`,
    );
  });

  it("creates a trigger via POST /v1/routines/:id/triggers", async () => {
    const id = newId<"routine-schedule">();
    const trigger = {
      id: newId<"routine-trigger">(),
      ownerId: newId<"user">(),
      routineScheduleId: id,
      kind: "webhook",
      config: {},
      enabled: true,
      revision: 1,
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z",
    };
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ trigger }, { status: 201 })],
      calls,
      { token: "t" },
    );

    const result = await client.routines.triggers.create(id, {
      kind: "webhook",
      config: {},
    });

    expect(result.kind).toBe("webhook");
    expect(calls[0]?.init.method).toBe("POST");
  });

  it("gets a webhook via GET /v1/routines/:id/webhook", async () => {
    const id = newId<"routine-schedule">();
    const webhook = {
      id: newId<"routine-webhook">(),
      ownerId: newId<"user">(),
      routineScheduleId: id,
      enabled: true,
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z",
    };
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse({ webhook })], calls, {
      token: "t",
    });

    const result = await client.routines.webhooks.get(id);

    expect(result.enabled).toBe(true);
    expect(calls[0]?.url).toBe(
      `https://api.example.test/v1/routines/${id}/webhook`,
    );
  });

  it("creates a webhook and returns the secret", async () => {
    const id = newId<"routine-schedule">();
    const webhook = {
      id: newId<"routine-webhook">(),
      ownerId: newId<"user">(),
      routineScheduleId: id,
      enabled: true,
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z",
    };
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ webhook, secret: "whsec_test" }, { status: 201 })],
      calls,
      { token: "t" },
    );

    const result = await client.routines.webhooks.create(id);

    expect(result.secret).toBe("whsec_test");
    expect(result.webhook.enabled).toBe(true);
  });

  it("lists templates via GET /v1/routine-templates", async () => {
    const template = {
      id: "morning-briefing",
      name: "Morning Briefing",
      summary: "Prepare a concise briefing.",
      setupPrompt: "Prepare a briefing.",
      defaultApprovalMode: "require_approval",
    };
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ templates: [template] })],
      calls,
      { token: "t" },
    );

    const result = await client.routines.templates.list();

    expect(result).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.example.test/v1/routine-templates");
  });

  it("installs a template via POST /v1/routine-templates/:id/install", async () => {
    const routine = routineFixture();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ routine }, { status: 201 })],
      calls,
      { token: "t" },
    );

    const result = await client.routines.templates.install("morning-briefing", {
      cron: "0 8 * * *",
      nextRunAt: "2026-08-07T08:00:00.000Z",
    });

    expect(result.name).toBe("Morning Briefing");
    expect(calls[0]?.url).toBe(
      "https://api.example.test/v1/routine-templates/morning-briefing/install",
    );
  });

  it("runs a routine via POST /v1/routines/:id/run with idempotency key", async () => {
    const id = newId<"routine-schedule">();
    const run = {
      id: newId<"integration-sync-run">(),
      ownerId: newId<"user">(),
      accountId: newId<"connected-account">(),
      routineScheduleId: id,
      provider: "manual",
      status: "queued",
      triggerType: "manual",
      triggerData: { input: "hello" },
      idempotencyKey: null,
      replayOfRunId: null,
      replayKey: null,
      cursor: {},
      errorCode: null,
      startedAt: null,
      finishedAt: null,
      runtimeRunId: null,
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z",
    };
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse({ run }, { status: 202 })], calls, {
      token: "t",
    });

    const result = await client.routines.run(id, "hello");

    expect(result.run.status).toBe("queued");
    expect(calls[0]?.init.headers["Idempotency-Key"]).toBeDefined();
    expect(JSON.parse(calls[0]?.init.body as string).input).toBe("hello");
  });

  it("creates a share link via POST /v1/routines/:id/shares", async () => {
    const id = newId<"routine-schedule">();
    const share = {
      id: newId<"routine-share">(),
      ownerId: newId<"user">(),
      routineScheduleId: id,
      expiresAt: "2026-08-07T00:00:00.000Z",
      revokedAt: null,
      createdAt: "2026-08-06T00:00:00.000Z",
    };
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ share, token: "rtnshare_test" }, { status: 201 })],
      calls,
      { token: "t" },
    );

    const result = await client.routines.shares.create(
      id,
      "2026-08-07T00:00:00.000Z",
    );

    expect(result.token).toBe("rtnshare_test");
    expect(result.share.routineScheduleId).toBe(id);
  });

  it("replays a run via POST /v1/routine-runs/:runId/replay", async () => {
    const runId = newId<"integration-sync-run">();
    const run = {
      id: runId,
      ownerId: newId<"user">(),
      accountId: newId<"connected-account">(),
      routineScheduleId: null,
      provider: "manual",
      status: "queued",
      triggerType: "manual",
      triggerData: {},
      idempotencyKey: null,
      replayOfRunId: runId,
      replayKey: null,
      cursor: {},
      errorCode: null,
      startedAt: null,
      finishedAt: null,
      runtimeRunId: null,
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z",
    };
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse({ run }, { status: 202 })], calls, {
      token: "t",
    });

    const result = await client.routines.runs.replay(runId);

    expect(result.status).toBe("queued");
    expect(calls[0]?.init.headers["Idempotency-Key"]).toBeDefined();
  });

  it("throws TownApiError on 404 for missing routine", async () => {
    const calls: FetchCall[] = [];
    const client = makeClient(
      [
        jsonResponse({ error: "ROUTINE_NOT_FOUND" }, { status: 404 }),
        jsonResponse({ error: "ROUTINE_NOT_FOUND" }, { status: 404 }),
      ],
      calls,
      { token: "t" },
    );

    await expect(client.routines.list()).rejects.toMatchObject({
      status: 404,
      code: "ROUTINE_NOT_FOUND",
    });
    await expect(client.routines.list()).rejects.toBeInstanceOf(TownApiError);
  });

  it("throws TownApiError instance on 403", async () => {
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ code: "ACCESS_DENIED" }, { status: 403 })],
      calls,
      { token: "t" },
    );

    await expect(client.routines.list()).rejects.toBeInstanceOf(TownApiError);
  });

  it("throws TownApiError on 409 conflict", async () => {
    const id = newId<"routine-schedule">();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ error: "ROUTINE_CONFLICT" }, { status: 409 })],
      calls,
      { token: "t" },
    );

    await expect(
      client.routines.update(id, {
        agentId: newId<"agent">(),
        agentVersionId: newId<"agent-version">(),
        name: "Test",
        cron: "0 8 * * *",
        timezone: "UTC",
        nextRunAt: "2026-08-07T08:00:00.000Z",
        enabled: true,
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ status: 409, code: "ROUTINE_CONFLICT" });
  });

  it("throws TownApiError on 429 rate limit", async () => {
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ error: "RATE_LIMITED" }, { status: 429 })],
      calls,
      { token: "t" },
    );

    await expect(
      client.routines.run(newId<"routine-schedule">(), "test"),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("throws when get cannot find the routine in the list", async () => {
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse({ routines: [] })], calls, {
      token: "t",
    });

    await expect(
      client.routines.get(newId<"routine-schedule">()),
    ).rejects.toMatchObject({ status: 404, code: "ROUTINE_NOT_FOUND" });
  });
});
