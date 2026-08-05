import { describe, expect, it, vi } from "vitest";

import { newId } from "@town/contracts";

import { TownApiError, TownClient } from "../src/index.js";

type FetchCall = {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
};

/** Minimal Response shape used by the client (json + ok + status + body). */
function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const status = init.status ?? 200;
  // 204 responses must not carry a body.
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

describe("TownClient auth namespace", () => {
  it("posts email to /v1/auth/session and returns the token envelope", async () => {
    const calls: FetchCall[] = [];
    const session = {
      token: "tok_123",
      user: {
        id: newId<"user">(),
        email: "a@b.test",
        firstName: null,
        lastName: null,
        timezone: "UTC",
        status: "active",
      },
      session: {
        id: newId<"auth-session">(),
        expiresAt: "2026-08-07T00:00:00.000Z",
      },
    };
    const client = makeClient([jsonResponse(session, { status: 201 })], calls);

    const result = await client.auth.createSession("a@b.test");

    expect(calls[0]?.url).toBe("https://api.example.test/v1/auth/session");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      email: "a@b.test",
    });
    expect(result.token).toBe("tok_123");
    expect(result.user.email).toBe("a@b.test");
  });

  it("deletes /v1/me/session with the bearer token", async () => {
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse(null, { status: 204 })], calls, {
      token: "tok_123",
    });

    await client.auth.deleteSession();

    expect(calls[0]?.url).toBe("https://api.example.test/v1/me/session");
    expect(calls[0]?.init.method).toBe("DELETE");
    expect(calls[0]?.init.headers["Authorization"]).toBe("Bearer tok_123");
  });
});

describe("TownClient me namespace", () => {
  it("unwraps the user from GET /v1/me", async () => {
    const user = {
      id: newId<"user">(),
      email: "a@b.test",
      firstName: "A",
      lastName: null,
      timezone: "UTC",
      status: "active",
    };
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse({ user })], calls, { token: "t" });

    const result = await client.me.get();

    expect(calls[0]?.init.method).toBe("GET");
    expect(result.email).toBe("a@b.test");
  });
});

describe("TownClient threads namespace", () => {
  it("lists threads with cursor/limit query", async () => {
    const page = { items: [], nextCursor: null };
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse(page)], calls, { token: "t" });

    const result = await client.threads.list({ cursor: "c", limit: 10 });

    expect(calls[0]?.url).toBe(
      "https://api.example.test/v1/threads?cursor=c&limit=10",
    );
    expect(result).toEqual(page);
  });

  it("gets a single thread by id and unwraps it", async () => {
    const thread = {
      id: newId<"thread">(),
      ownerId: newId<"user">(),
      agentId: newId<"agent">(),
      kind: "assistant",
      title: "Town workspace",
      approvalMode: "respect_tool_setting",
      status: "active",
      pinnedAt: null,
      revision: 1,
      lastTurnSequence: 0,
      readThroughSequence: 0,
      unread: false,
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z",
    };
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse({ thread })], calls, {
      token: "t",
    });

    const result = await client.threads.get(thread.id);

    expect(calls[0]?.url).toBe(
      `https://api.example.test/v1/threads/${thread.id}`,
    );
    expect(result.title).toBe("Town workspace");
  });

  it("creates a thread and returns the unwrapped thread", async () => {
    const thread = {
      id: newId<"thread">(),
      ownerId: newId<"user">(),
      agentId: newId<"agent">(),
      kind: "assistant",
      title: "New",
      approvalMode: "autonomous",
      status: "active",
      pinnedAt: null,
      revision: 1,
      lastTurnSequence: 0,
      readThroughSequence: 0,
      unread: false,
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z",
    };
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ thread }, { status: 201 })],
      calls,
      {
        token: "t",
      },
    );

    const result = await client.threads.create({
      title: "New",
      approvalMode: "autonomous",
    });

    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      title: "New",
      approvalMode: "autonomous",
    });
    expect(result.id).toBe(thread.id);
  });

  it("lists turns for a thread", async () => {
    const page = { items: [], nextCursor: null };
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse(page)], calls, { token: "t" });

    const threadId = newId<"thread">();
    const result = await client.threads.turns(threadId, { limit: 5 });

    expect(calls[0]?.url).toBe(
      `https://api.example.test/v1/threads/${threadId}/turns?limit=5`,
    );
    expect(result).toEqual(page);
  });
});

describe("TownClient sessions namespace", () => {
  it("submits a message with an idempotency key and default mentions", async () => {
    const sessionId = newId<"runtime-session">();
    const submission = {
      session: {
        id: sessionId,
        ownerId: newId<"user">(),
        threadId: newId<"thread">(),
        agentId: newId<"agent">(),
        state: "idle",
        revision: 1,
        lastEventSequence: 0,
        agentVersion: {
          id: newId<"agent-version">(),
          agentId: newId<"agent">(),
          version: 1,
          snapshot: {
            displayName: "Town",
            instructions: "x",
            defaultApprovalMode: "respect_tool_setting",
            callableRoutineIds: [],
          },
          changeReason: null,
          createdBy: "system",
          createdAt: "2026-08-06T00:00:00.000Z",
        },
        createdAt: "2026-08-06T00:00:00.000Z",
        updatedAt: "2026-08-06T00:00:00.000Z",
      },
      run: {
        id: newId<"session-run">(),
        sessionId,
        triggeringTurnId: newId<"thread-turn">(),
        state: "queued",
        attempt: 1,
        waitReason: null,
        inputResponse: null,
        outcome: null,
        errorCode: null,
        createdAt: "2026-08-06T00:00:00.000Z",
        startedAt: null,
        finishedAt: null,
        updatedAt: "2026-08-06T00:00:00.000Z",
      },
      turn: {
        id: newId<"thread-turn">(),
        ownerId: newId<"user">(),
        threadId: newId<"thread">(),
        sequence: 1,
        role: "user",
        text: "hello",
        sourceType: "user",
        sourceRef: null,
        mentions: [],
        createdAt: "2026-08-06T00:00:00.000Z",
      },
      replayed: false,
    };
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse(submission, { status: 202 })],
      calls,
      {
        token: "t",
      },
    );

    const threadId = newId<"thread">();
    const result = await client.sessions.create(threadId, { text: "hello" });

    expect(calls[0]?.url).toBe(
      `https://api.example.test/v1/threads/${threadId}/messages`,
    );
    expect(calls[0]?.init.headers["Idempotency-Key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      text: "hello",
      mentions: [],
    });
    expect(result.session.id).toBe(sessionId);
    expect(result.run.state).toBe("queued");
  });
});

describe("TownClient error handling", () => {
  it("throws TownApiError with status and code on 401", async () => {
    const calls: FetchCall[] = [];
    const unauthorized = jsonResponse(
      { code: "UNAUTHENTICATED", detail: "bad token", status: 401 },
      { status: 401 },
    );
    const client = makeClient(
      [
        unauthorized,
        jsonResponse(
          { code: "UNAUTHENTICATED", detail: "bad token", status: 401 },
          { status: 401 },
        ),
      ],
      calls,
      { token: "bad" },
    );

    await expect(client.me.get()).rejects.toMatchObject({
      name: "TownApiError",
      status: 401,
      code: "UNAUTHENTICATED",
    });
    await expect(client.me.get()).rejects.toBeInstanceOf(TownApiError);
  });

  it("throws TownApiError with status 403 for an allowlist rejection", async () => {
    const client = makeClient(
      [
        jsonResponse(
          { code: "ACCESS_DENIED", detail: "not allowed", status: 403 },
          { status: 403 },
        ),
      ],
      [],
    );

    await expect(client.auth.createSession("x@y.test")).rejects.toMatchObject({
      status: 403,
      code: "ACCESS_DENIED",
    });
  });

  it("throws TownApiError with status 429 when rate limited", async () => {
    const client = makeClient(
      [
        jsonResponse(
          { code: "RATE_LIMITED", detail: "slow down", status: 429 },
          { status: 429 },
        ),
      ],
      [],
    );

    await expect(client.auth.createSession("x@y.test")).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
    });
  });
});
