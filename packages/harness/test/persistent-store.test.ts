import { describe, expect, it } from "vitest";

import {
  createAppServer,
  type PersistentThreadStore,
  type ThreadSnapshot,
} from "../src/app-server.js";

describe("persistent thread store boundary", () => {
  it("supports an asynchronous durable store without changing the protocol", async () => {
    const snapshots = new Map<string, ThreadSnapshot>();
    const store: PersistentThreadStore = {
      now: () => Date.now(),
      async get(threadId) {
        return snapshots.get(threadId);
      },
      async set(threadId, snapshot) {
        snapshots.set(threadId, structuredClone(snapshot));
      },
      async compareAndSet(threadId, expected, snapshot) {
        const current = snapshots.get(threadId);
        if (
          current === undefined ||
          current.revision !== expected.revision ||
          current.leaseOwner !== expected.leaseOwner
        )
          return false;
        snapshots.set(threadId, structuredClone(snapshot));
        return true;
      },
    };
    const server = createAppServer({
      store,
      createAgent: () => ({
        model: {
          async respond() {
            return { kind: "final", text: "persisted" as const };
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
    await server.dispatch({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, text: "hello" },
    });
    expect(snapshots.get(threadId)?.items).toEqual([
      { type: "user_message", text: "hello" },
      { type: "assistant_message", text: "persisted" },
    ]);
  });

  it("persists the tool-call boundary before executing a side effect", async () => {
    const snapshots = new Map<string, ThreadSnapshot>();
    let threadId = "";
    let sawDurableCall = false;
    const store: PersistentThreadStore = {
      now: () => Date.now(),
      async get(id) {
        return snapshots.get(id);
      },
      async set(id, snapshot) {
        snapshots.set(id, structuredClone(snapshot));
      },
      async compareAndSet(id, expected, snapshot) {
        const current = snapshots.get(id);
        if (
          current === undefined ||
          current.revision !== expected.revision ||
          current.leaseOwner !== expected.leaseOwner
        )
          return false;
        snapshots.set(id, structuredClone(snapshot));
        return true;
      },
    };
    const server = createAppServer({
      store,
      createAgent: () => ({
        model: {
          async respond({ items }) {
            if (items.some((item) => item.type === "tool_result"))
              return { kind: "final", text: "done" as const };
            return {
              kind: "tool_call",
              callId: "call-1",
              toolName: "side-effect",
              arguments: {},
            } as const;
          },
        },
        tools: [
          {
            name: "side-effect",
            async execute() {
              sawDurableCall =
                snapshots
                  .get(threadId)
                  ?.items.some(
                    (item) =>
                      item.type === "assistant_tool_call" &&
                      item.callId === "call-1",
                  ) ?? false;
              return { kind: "result", output: "ok" as const };
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
    threadId = (started as { result: { threadId: string } }).result.threadId;
    await server.dispatch({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, text: "run" },
    });
    expect(sawDurableCall).toBe(true);
  });

  it("does not execute a tool when the durable event barrier fails", async () => {
    const snapshots = new Map<string, ThreadSnapshot>();
    let compareCount = 0;
    let executions = 0;
    const store: PersistentThreadStore = {
      now: () => Date.now(),
      async get(id) {
        return snapshots.get(id);
      },
      async set(id, snapshot) {
        snapshots.set(id, structuredClone(snapshot));
      },
      async compareAndSet(id, expected, snapshot) {
        compareCount += 1;
        if (compareCount >= 2) return false;
        const current = snapshots.get(id);
        if (
          current === undefined ||
          current.revision !== expected.revision ||
          current.leaseOwner !== expected.leaseOwner
        )
          return false;
        snapshots.set(id, structuredClone(snapshot));
        return true;
      },
    };
    const server = createAppServer({
      store,
      createAgent: () => ({
        model: {
          async respond() {
            return {
              kind: "tool_call",
              callId: "blocked-call",
              toolName: "side-effect",
              arguments: {},
            } as const;
          },
        },
        tools: [
          {
            name: "side-effect",
            async execute() {
              executions += 1;
              return { kind: "result", output: "unexpected" as const };
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
    const response = await server.dispatch({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, text: "run" },
    });
    expect(response).toMatchObject({ error: { code: -32005 } });
    expect(executions).toBe(0);
  });
});
