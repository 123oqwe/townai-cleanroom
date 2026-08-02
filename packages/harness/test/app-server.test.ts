import { describe, expect, it } from "vitest";
import { createAppServer, type ThreadStore } from "../src/app-server.js";

describe("Codex-style bidirectional app server", () => {
  it("requires initialize and exposes a thread/turn notification stream", async () => {
    const store: ThreadStore = new Map();
    const inputLengths: number[] = [];
    const server = createAppServer({
      store,
      createAgent: () => ({
        model: {
          async respond(input) {
            inputLengths.push(input.items.length);
            return { kind: "final", text: "done" as const };
          },
        },
        tools: [],
      }),
    });
    const rejected = await server.dispatch({
      jsonrpc: "2.0",
      id: 1,
      method: "thread/start",
      params: {},
    });
    expect(rejected).toMatchObject({ error: { code: -32001 } });
    await expect(
      server.dispatch({
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: { clientInfo: { name: "test", version: "1" } },
      }),
    ).resolves.toMatchObject({ result: { protocolVersion: "1" } });
    const started = await server.dispatch({
      jsonrpc: "2.0",
      id: 3,
      method: "thread/start",
      params: {},
    });
    const threadId = (started as { result: { threadId: string } }).result
      .threadId;
    const turn = await server.dispatch({
      jsonrpc: "2.0",
      id: 4,
      method: "turn/start",
      params: { threadId, text: "hello" },
    });
    expect(turn).toMatchObject({ result: { kind: "completed", text: "done" } });
    expect(
      (turn as { notifications: Array<{ method: string }> }).notifications.map(
        (item) => item.method,
      ),
    ).toEqual([
      "turn/started",
      "item/started",
      "item/completed",
      "turn/completed",
    ]);
    expect(store.get(threadId)).toMatchObject({
      threadId,
      items: [
        { type: "user_message", text: "hello" },
        { type: "assistant_message", text: "done" },
      ],
    });
    const second = await server.dispatch({
      jsonrpc: "2.0",
      id: 5,
      method: "turn/start",
      params: { threadId, text: "again" },
    });
    expect(second).toMatchObject({
      result: { kind: "completed", text: "done" },
    });
    expect(inputLengths).toEqual([1, 3]);
  });

  it("returns an approval notification and resumes the same thread", async () => {
    const store: ThreadStore = new Map();
    let call = 0;
    const server = createAppServer({
      store,
      createAgent: () => ({
        model: {
          async respond() {
            call += 1;
            return call === 1
              ? {
                  kind: "tool_call",
                  callId: "approval-1",
                  toolName: "send",
                  arguments: {},
                }
              : { kind: "final", text: "sent" };
          },
        },
        tools: [
          {
            name: "send",
            requiresApproval: true,
            async execute() {
              return { kind: "result", output: "ok" };
            },
          },
        ],
      }),
    });
    await server.dispatch({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "test", version: "1" } },
    });
    const started = await server.dispatch({
      jsonrpc: "2.0",
      id: 2,
      method: "thread/start",
      params: {},
    });
    const threadId = (started as { result: { threadId: string } }).result
      .threadId;
    const paused = await server.dispatch({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, text: "send" },
    });
    expect(paused).toMatchObject({
      result: { kind: "paused", approvalId: "approval-1" },
    });
    const resumed = await server.dispatch({
      jsonrpc: "2.0",
      id: 4,
      method: "approval/resolve",
      params: { threadId, approvalId: "approval-1", decision: "approve" },
    });
    expect(resumed).toMatchObject({
      result: { kind: "completed", text: "sent" },
    });
    expect(
      (
        resumed as { notifications: Array<{ method: string }> }
      ).notifications.map((item) => item.method),
    ).toEqual([
      "approval/resolved",
      "item/started",
      "item/completed",
      "item/started",
      "item/completed",
      "turn/completed",
    ]);
  });

  it("rejects invalid decisions without changing a pending approval", async () => {
    const store: ThreadStore = new Map();
    const server = createAppServer({
      store,
      createAgent: () => ({
        model: {
          async respond() {
            return {
              kind: "tool_call" as const,
              callId: "approval-invalid",
              toolName: "send",
              arguments: {},
            };
          },
        },
        tools: [
          {
            name: "send",
            requiresApproval: true,
            async execute() {
              return { kind: "result" as const, output: "ok" };
            },
          },
        ],
      }),
    });
    await server.dispatch({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });
    const started = await server.dispatch({
      jsonrpc: "2.0",
      id: 2,
      method: "thread/start",
      params: {},
    });
    const threadId = (started as { result: { threadId: string } }).result
      .threadId;
    await server.dispatch({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, text: "send" },
    });
    const invalid = await server.dispatch({
      jsonrpc: "2.0",
      id: 4,
      method: "approval/resolve",
      params: { threadId, approvalId: "approval-invalid", decision: "wat" },
    });
    expect(invalid).toMatchObject({ error: { code: -32602 } });
    expect(store.get(threadId)?.pendingApproval?.callId).toBe(
      "approval-invalid",
    );
  });

  it("serializes same-thread work and returns a conflict while a turn is running", async () => {
    const store: ThreadStore = new Map();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => (release = resolve));
    const server = createAppServer({
      store,
      createAgent: () => ({
        model: {
          async respond() {
            await waiting;
            return { kind: "final" as const, text: "done" };
          },
        },
        tools: [],
      }),
    });
    await server.dispatch({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });
    const started = await server.dispatch({
      jsonrpc: "2.0",
      id: 2,
      method: "thread/start",
      params: {},
    });
    const threadId = (started as { result: { threadId: string } }).result
      .threadId;
    const first = server.dispatch({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, text: "one" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await server.dispatch({
      jsonrpc: "2.0",
      id: 4,
      method: "turn/start",
      params: { threadId, text: "two" },
    });
    expect(second).toMatchObject({ error: { code: -32005 } });
    release();
    await expect(first).resolves.toMatchObject({
      result: { kind: "completed" },
    });
  });

  it("hydrates a pending approval in a fresh server instance", async () => {
    const store: ThreadStore = new Map();
    const agent = {
      model: {
        async respond() {
          return {
            kind: "tool_call" as const,
            callId: "persisted-approval",
            toolName: "send",
            arguments: {},
          };
        },
      },
      tools: [
        {
          name: "send",
          requiresApproval: true,
          async execute() {
            return { kind: "result" as const, output: "ok" };
          },
        },
      ],
    };
    const server1 = createAppServer({ store, createAgent: () => agent });
    await server1.dispatch({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });
    const started = await server1.dispatch({
      jsonrpc: "2.0",
      id: 2,
      method: "thread/start",
      params: {},
    });
    const threadId = (started as { result: { threadId: string } }).result
      .threadId;
    await server1.dispatch({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, text: "send" },
    });
    const server2 = createAppServer({
      store,
      createAgent: () => ({
        model: {
          async respond() {
            return { kind: "final" as const, text: "recovered" };
          },
        },
        tools: agent.tools,
      }),
    });
    await server2.dispatch({
      jsonrpc: "2.0",
      id: 4,
      method: "initialize",
      params: {},
    });
    const resumed = await server2.dispatch({
      jsonrpc: "2.0",
      id: 5,
      method: "approval/resolve",
      params: {
        threadId,
        approvalId: "persisted-approval",
        decision: "approve",
      },
    });
    expect(resumed).toMatchObject({
      result: { kind: "completed", text: "recovered" },
    });
  });

  it("maps model failures to a JSON-RPC error instead of rejecting dispatch", async () => {
    const store: ThreadStore = new Map();
    const server = createAppServer({
      store,
      createAgent: () => ({
        model: {
          async respond() {
            throw new Error("model unavailable");
          },
        },
        tools: [],
      }),
    });
    await server.dispatch({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });
    const started = await server.dispatch({
      jsonrpc: "2.0",
      id: 2,
      method: "thread/start",
      params: {},
    });
    const threadId = (started as { result: { threadId: string } }).result
      .threadId;
    const failed = await server.dispatch({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, text: "fail" },
    });
    expect(failed).toMatchObject({
      error: { code: -32000, message: "model unavailable" },
    });
    expect(
      (
        failed as { notifications: Array<{ method: string }> }
      ).notifications.map((item) => item.method),
    ).toContain("turn/started");
  });

  it("rejects a stale approval from another server instance", async () => {
    const store: ThreadStore = new Map();
    let executions = 0;
    const makeAgent = (final = false) => ({
      model: {
        async respond() {
          return final
            ? { kind: "final" as const, text: "done" }
            : {
                kind: "tool_call" as const,
                callId: "shared-approval",
                toolName: "send",
                arguments: {},
              };
        },
      },
      tools: [
        {
          name: "send",
          requiresApproval: true,
          async execute() {
            executions += 1;
            return { kind: "result" as const, output: "ok" };
          },
        },
      ],
    });
    const server1 = createAppServer({ store, createAgent: () => makeAgent() });
    await server1.dispatch({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });
    const started = await server1.dispatch({
      jsonrpc: "2.0",
      id: 2,
      method: "thread/start",
      params: {},
    });
    const threadId = (started as { result: { threadId: string } }).result
      .threadId;
    await server1.dispatch({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, text: "send" },
    });
    const server2 = createAppServer({
      store,
      createAgent: () => makeAgent(true),
    });
    await server2.dispatch({
      jsonrpc: "2.0",
      id: 4,
      method: "initialize",
      params: {},
    });
    await expect(
      server2.dispatch({
        jsonrpc: "2.0",
        id: 5,
        method: "approval/resolve",
        params: {
          threadId,
          approvalId: "shared-approval",
          decision: "approve",
        },
      }),
    ).resolves.toMatchObject({ result: { kind: "completed" } });
    await expect(
      server1.dispatch({
        jsonrpc: "2.0",
        id: 6,
        method: "approval/resolve",
        params: {
          threadId,
          approvalId: "shared-approval",
          decision: "approve",
        },
      }),
    ).resolves.toMatchObject({ error: { code: -32005 } });
    expect(executions).toBe(1);
  });

  it("reclaims a lease left behind after its trusted expiry", async () => {
    const store: ThreadStore = new Map();
    const server = createAppServer({
      store,
      createAgent: () => ({
        model: {
          async respond() {
            return { kind: "final" as const, text: "reclaimed" };
          },
        },
        tools: [],
      }),
    });
    await server.dispatch({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });
    const started = await server.dispatch({
      jsonrpc: "2.0",
      id: 2,
      method: "thread/start",
      params: {},
    });
    const threadId = (started as { result: { threadId: string } }).result
      .threadId;
    const snapshot = store.get(threadId);
    if (snapshot === undefined) throw new Error("missing test snapshot");
    store.set(threadId, {
      ...snapshot,
      leaseOwner: "dead-server",
      leaseExpiresAt: Date.now() - 1,
    });
    await expect(
      server.dispatch({
        jsonrpc: "2.0",
        id: 3,
        method: "turn/start",
        params: { threadId, text: "recover" },
      }),
    ).resolves.toMatchObject({
      result: { kind: "completed", text: "reclaimed" },
    });
  });
});
