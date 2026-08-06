import { describe, expect, it, vi } from "vitest";

import { newId } from "@town/contracts";

import { TownClient } from "../src/index.js";

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

function taskFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: newId<"task">(),
    ownerId: newId<"user">(),
    agentId: newId<"agent">(),
    title: "Review PR",
    description: "Review the open PR",
    status: "open",
    approvalMode: "respect_tool_setting",
    unread: true,
    scheduledFor: null,
    sourceThreads: [],
    currentRevision: 1,
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("TownClient tasks namespace", () => {
  it("lists tasks via GET /v1/tasks with status and limit", async () => {
    const task = taskFixture();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ items: [task], nextCursor: null })],
      calls,
      { token: "t" },
    );

    const page = await client.tasks.list({ status: "open", limit: 50 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.title).toBe("Review PR");
    expect(page.nextCursor).toBeNull();
    expect(calls[0]?.url).toContain("/v1/tasks");
    expect(calls[0]?.url).toContain("status=open");
    expect(calls[0]?.url).toContain("limit=50");
    expect(calls[0]?.init.method).toBe("GET");
  });

  it("gets a single task via GET /v1/tasks/:id", async () => {
    const id = newId<"task">();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ task: taskFixture({ id, title: "My Task" }) })],
      calls,
      { token: "t" },
    );

    const task = await client.tasks.get(id);

    expect(task.id).toBe(id);
    expect(task.title).toBe("My Task");
    expect(calls[0]?.url).toBe(`https://api.example.test/v1/tasks/${id}`);
  });

  it("creates a task via POST /v1/tasks", async () => {
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ task: taskFixture({ title: "New Task" }) })],
      calls,
      { token: "t" },
    );

    const task = await client.tasks.create({
      title: "New Task",
      approvalMode: "autonomous",
    });

    expect(task.title).toBe("New Task");
    expect(calls[0]?.init.method).toBe("POST");
    const body = JSON.parse(calls[0]?.init.body as string);
    expect(body.title).toBe("New Task");
    expect(body.approvalMode).toBe("autonomous");
  });

  it("updates a task via PATCH /v1/tasks/:id", async () => {
    const id = newId<"task">();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [
        jsonResponse({
          task: taskFixture({ id, status: "completed", currentRevision: 2 }),
        }),
      ],
      calls,
      { token: "t" },
    );

    const task = await client.tasks.update(id, {
      expectedRevision: 1,
      title: "Review PR",
      description: "Done",
      status: "completed",
      scheduledFor: null,
    });

    expect(task.status).toBe("completed");
    expect(task.currentRevision).toBe(2);
    expect(calls[0]?.init.method).toBe("PATCH");
    const body = JSON.parse(calls[0]?.init.body as string);
    expect(body.expectedRevision).toBe(1);
  });

  it("deletes a task via DELETE /v1/tasks/:id with expectedRevision", async () => {
    const id = newId<"task">();
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse(null, { status: 204 })], calls, {
      token: "t",
    });

    await client.tasks.delete(id, 3);

    expect(calls[0]?.init.method).toBe("DELETE");
    expect(calls[0]?.url).toContain(`expectedRevision=3`);
  });

  it("marks a task read via POST /v1/tasks/:id/mark-read", async () => {
    const id = newId<"task">();
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse(null, { status: 204 })], calls, {
      token: "t",
    });

    await client.tasks.markRead(id);

    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.url).toContain(`/v1/tasks/${id}/mark-read`);
  });
});
