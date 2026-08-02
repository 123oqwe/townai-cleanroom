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
      async get(threadId) {
        return snapshots.get(threadId);
      },
      async set(threadId, snapshot) {
        snapshots.set(threadId, structuredClone(snapshot));
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
});
