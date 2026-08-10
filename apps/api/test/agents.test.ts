import { randomBytes } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
} from "vitest";
import postgres, { type Sql } from "postgres";

import {
  createAgentRepository,
  createInputRequestRepository,
  createTaskRepository,
  createThreadRepository,
  createTurnRepository,
} from "@town/agents";
import { newId } from "@town/contracts";
import { runMigrations } from "@town/db";
import {
  createAccountRepository,
  createCredentialCipher,
  createIdentityService,
} from "@town/identity";

import { createApp } from "../src/app.js";

let sql: Sql;

beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 6 });
  await runMigrations(sql);
});

beforeEach(async () => {
  await sql`truncate table users, access_allowlist cascade`;
});

afterAll(async () => {
  await sql.end();
});

async function fixture() {
  await sql`
    insert into access_allowlist (email, enabled)
    values ('agents-owner@example.invalid', true),
           ('agents-other@example.invalid', true)
  `;
  const identityService = createIdentityService(sql);
  const accountRepository = createAccountRepository(
    sql,
    createCredentialCipher(randomBytes(32).toString("base64url")),
  );
  const agentRepository = createAgentRepository(sql);
  const threadRepository = createThreadRepository(sql);
  const turnRepository = createTurnRepository(sql);
  const taskRepository = createTaskRepository(sql);
  const inputRequestRepository = createInputRequestRepository(sql);
  const owner = await identityService.establishLegacyIdentityForTestOnly({
    email: "agents-owner@example.invalid",
    timezone: "Asia/Shanghai",
  });
  const other = await identityService.establishLegacyIdentityForTestOnly({
    email: "agents-other@example.invalid",
    timezone: "UTC",
  });
  const dependencies = {
    identityService,
    accountRepository,
    agentRepository,
    threadRepository,
    turnRepository,
    taskRepository,
    inputRequestRepository,
  };
  return {
    app: createApp(dependencies),
    dependencies,
    owner,
    other,
  };
}

function authorization(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function createPersonal(
  app: Awaited<ReturnType<typeof fixture>>["app"],
  token: string,
) {
  return app.request("/v1/agents/personal", {
    method: "POST",
    headers: authorization(token),
    body: JSON.stringify({
      displayName: "API Test Assistant",
      instructions: "Use only synthetic API fixtures.",
      defaultApprovalMode: "respect_tool_setting",
    }),
  });
}

describe("protected Agent, Thread, and Task API", () => {
  it("requires authentication, rejects spoofed provenance, and redacts internals", async () => {
    const { app, owner, other } = await fixture();
    const unauthenticated = await app.request("/v1/agents/personal");
    expect(unauthenticated.status).toBe(401);

    await createPersonal(app, owner.token);
    const spoofed = await app.request("/v1/threads", {
      method: "POST",
      headers: authorization(owner.token),
      body: JSON.stringify({
        title: "Attempted spoof",
        approvalMode: "autonomous",
        role: "assistant",
        sourceType: "runtime",
        ownerId: other.user.id,
      }),
    });
    const malformed = await app.request("/v1/threads?unread=maybe", {
      headers: authorization(owner.token),
    });
    const malformedCursor = await app.request("/v1/threads?cursor=%25%25%25", {
      headers: authorization(owner.token),
    });
    const noPublicTurnPost = await app.request("/v1/threads/not-a-turn/turns", {
      method: "POST",
      headers: authorization(owner.token),
      body: JSON.stringify({ role: "assistant", text: "forged" }),
    });

    expect(spoofed.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(malformedCursor.status).toBe(400);
    expect(noPublicTurnPost.status).toBe(404);
    const serialized = JSON.stringify(await spoofed.json());
    expect(serialized).not.toMatch(
      /token_hash|accessToken|refreshToken|credential|envelope|internalPrompt|sql/i,
    );
  });

  it("creates, reads, publishes, and paginates the personal Agent", async () => {
    const { app, owner, other } = await fixture();
    const created = await createPersonal(app, owner.token);
    const duplicate = await createPersonal(app, owner.token);
    const read = await app.request("/v1/agents/personal", {
      headers: authorization(owner.token),
    });
    const published = await app.request("/v1/agents/personal", {
      method: "PUT",
      headers: authorization(owner.token),
      body: JSON.stringify({
        expectedRevision: 1,
        displayName: "API Test Assistant",
        instructions: "Ask before synthetic writes.",
        defaultApprovalMode: "require_approval",
        changeReason: "API test update",
      }),
    });
    const versions = await app.request("/v1/agents/personal/versions?limit=1", {
      headers: authorization(owner.token),
    });
    const otherRead = await app.request("/v1/agents/personal", {
      headers: authorization(other.token),
    });

    expect(created.status).toBe(201);
    expect(read.status).toBe(200);
    expect(published.status).toBe(200);
    expect(await published.json()).toMatchObject({ agent: { revision: 2 } });
    expect(versions.status).toBe(200);
    expect(await versions.json()).toMatchObject({
      items: [{ version: 2 }],
    });
    expect(duplicate.status).toBe(409);
    expect(otherRead.status).toBe(404);
  });

  it("exposes owner-scoped Routine Agent version history", async () => {
    const { app, owner, other } = await fixture();
    const created = await app.request("/v1/agents/routines", {
      method: "POST",
      headers: authorization(owner.token),
      body: JSON.stringify({
        displayName: "API Morning Routine",
        instructions: "Summarize the morning signals.",
        defaultApprovalMode: "require_approval",
      }),
    });
    const routine = (await created.json()) as { agent: { id: string } };
    const published = await app.request(
      `/v1/agents/routines/${routine.agent.id}`,
      {
        method: "PUT",
        headers: authorization(owner.token),
        body: JSON.stringify({
          expectedRevision: 1,
          displayName: "API Morning Routine v2",
          instructions: "Ask before external actions.",
          defaultApprovalMode: "require_approval",
        }),
      },
    );
    const versions = await app.request(
      `/v1/agents/routines/${routine.agent.id}/versions?limit=1`,
      { headers: authorization(owner.token) },
    );
    const otherVersions = await app.request(
      `/v1/agents/routines/${routine.agent.id}/versions`,
      { headers: authorization(other.token) },
    );

    expect(created.status).toBe(201);
    expect(published.status).toBe(200);
    expect(versions.status).toBe(200);
    expect(await versions.json()).toMatchObject({ items: [{ version: 2 }] });
    expect(otherVersions.status).toBe(404);
  });

  it("supports Thread metadata, read state, immutable Turn reads, and deletion", async () => {
    const { app, dependencies, owner, other } = await fixture();
    await createPersonal(app, owner.token);
    const createdResponse = await app.request("/v1/threads", {
      method: "POST",
      headers: authorization(owner.token),
      body: JSON.stringify({
        title: "API conversation",
        approvalMode: "respect_tool_setting",
      }),
    });
    const created = (await createdResponse.json()) as {
      thread: { id: string };
    };
    await dependencies.turnRepository.appendRuntime({
      ownerId: owner.user.id,
      threadId: created.thread.id as never,
      role: "assistant",
      text: "Synthetic durable response.",
      sourceRef: "api-test-session",
      mentions: [],
    });
    const list = await app.request("/v1/threads?kind=assistant&unread=true", {
      headers: authorization(owner.token),
    });
    const read = await app.request(`/v1/threads/${created.thread.id}`, {
      headers: authorization(owner.token),
    });
    const updated = await app.request(`/v1/threads/${created.thread.id}`, {
      method: "PATCH",
      headers: authorization(owner.token),
      body: JSON.stringify({
        expectedRevision: 1,
        title: "Renamed API conversation",
        status: "archived",
        pinned: true,
        approvalMode: "require_approval",
        forceUnread: true,
      }),
    });
    const stale = await app.request(`/v1/threads/${created.thread.id}`, {
      method: "PATCH",
      headers: authorization(owner.token),
      body: JSON.stringify({
        expectedRevision: 1,
        title: "Stale",
        status: "active",
        pinned: false,
        approvalMode: "autonomous",
        forceUnread: false,
      }),
    });
    const marked = await app.request(
      `/v1/threads/${created.thread.id}/mark-read`,
      {
        method: "POST",
        headers: authorization(owner.token),
        body: JSON.stringify({}),
      },
    );
    const turns = await app.request(`/v1/threads/${created.thread.id}/turns`, {
      headers: authorization(owner.token),
    });
    const otherRead = await app.request(`/v1/threads/${created.thread.id}`, {
      headers: authorization(other.token),
    });
    const removed = await app.request(
      `/v1/threads/${created.thread.id}?expectedRevision=2`,
      { method: "DELETE", headers: authorization(owner.token) },
    );

    expect(createdResponse.status).toBe(201);
    expect(list.status).toBe(200);
    expect(read.status).toBe(200);
    expect(updated.status).toBe(200);
    expect(stale.status).toBe(409);
    expect(marked.status).toBe(200);
    expect(await marked.json()).toMatchObject({ thread: { unread: false } });
    expect(await turns.json()).toMatchObject({
      items: [{ role: "assistant", sourceType: "runtime" }],
    });
    expect(otherRead.status).toBe(404);
    expect(removed.status).toBe(204);
  });

  it("supports Task lifecycle, context, unread, and InputRequest response", async () => {
    const { app, dependencies, owner, other } = await fixture();
    await createPersonal(app, owner.token);
    const sourceResponse = await app.request("/v1/threads", {
      method: "POST",
      headers: authorization(owner.token),
      body: JSON.stringify({
        title: "Task source",
        approvalMode: "respect_tool_setting",
      }),
    });
    const source = (await sourceResponse.json()) as { thread: { id: string } };
    const createdResponse = await app.request("/v1/tasks", {
      method: "POST",
      headers: authorization(owner.token),
      body: JSON.stringify({
        title: "API task",
        description: "Synthetic API task.",
        approvalMode: "require_approval",
        scheduledFor: "2099-01-01T00:00:00.000Z",
        sourceThreads: [source.thread.id],
      }),
    });
    const created = (await createdResponse.json()) as {
      task: { id: string; threadId: string };
    };
    await dependencies.turnRepository.appendRuntime({
      ownerId: owner.user.id,
      threadId: created.task.threadId as never,
      role: "assistant",
      text: "Task needs owner input.",
      sourceRef: "api-task-session",
      mentions: [],
    });
    const list = await app.request("/v1/tasks?status=open&unread=true", {
      headers: authorization(owner.token),
    });
    const read = await app.request(`/v1/tasks/${created.task.id}`, {
      headers: authorization(owner.token),
    });
    const updated = await app.request(`/v1/tasks/${created.task.id}`, {
      method: "PATCH",
      headers: authorization(owner.token),
      body: JSON.stringify({
        expectedRevision: 1,
        title: "Completed API task",
        description: "Done.",
        status: "completed",
        scheduledFor: null,
      }),
    });
    const marked = await app.request(`/v1/tasks/${created.task.id}/mark-read`, {
      method: "POST",
      headers: authorization(owner.token),
      body: JSON.stringify({}),
    });
    const request = await dependencies.inputRequestRepository.createInternal({
      ownerId: owner.user.id,
      taskId: created.task.id as never,
      prompt: "Choose a synthetic option.",
    });
    const requests = await app.request(
      `/v1/tasks/${created.task.id}/input-requests`,
      { headers: authorization(owner.token) },
    );
    const pendingRequests = await app.request("/v1/input-requests", {
      headers: authorization(owner.token),
    });
    expect(pendingRequests.status).toBe(200);
    expect(await pendingRequests.json()).toMatchObject({
      inputRequests: [{ id: request.id, status: "pending" }],
    });
    const answered = await app.request(
      `/v1/tasks/${created.task.id}/input-requests/${request.id}/respond`,
      {
        method: "POST",
        headers: authorization(owner.token),
        body: JSON.stringify({ response: "Proceed" }),
      },
    );
    const answeredAgain = await app.request(
      `/v1/tasks/${created.task.id}/input-requests/${request.id}/respond`,
      {
        method: "POST",
        headers: authorization(owner.token),
        body: JSON.stringify({ response: "Again" }),
      },
    );
    const otherRead = await app.request(`/v1/tasks/${created.task.id}`, {
      headers: authorization(other.token),
    });
    const removed = await app.request(
      `/v1/tasks/${created.task.id}?expectedRevision=2`,
      { method: "DELETE", headers: authorization(owner.token) },
    );

    expect(createdResponse.status).toBe(201);
    expect(list.status).toBe(200);
    expect(read.status).toBe(200);
    expect(updated.status).toBe(200);
    expect(marked.status).toBe(200);
    expect(requests.status).toBe(200);
    expect(answered.status).toBe(200);
    expect(answeredAgain.status).toBe(409);
    expect(otherRead.status).toBe(404);
    expect(removed.status).toBe(204);
  });

  it("maps a real unavailable source reference to a stable 422 problem", async () => {
    const { app, owner } = await fixture();
    await createPersonal(app, owner.token);
    const response = await app.request("/v1/tasks", {
      method: "POST",
      headers: authorization(owner.token),
      body: JSON.stringify({
        title: "Unavailable",
        description: "Synthetic.",
        approvalMode: "respect_tool_setting",
        sourceThreads: [newId<"thread">()],
      }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "REFERENCE_UNAVAILABLE",
    });
  });
});
