import { describe, expect, it } from "vitest";
import {
  createAppServer,
  type AppServerRequest,
  type ThreadStore,
} from "../src/app-server.js";

describe("Codex-style bidirectional app server", () => {
  it("requires initialize and exposes a thread/turn notification stream", async () => {
    const store: ThreadStore = new Map();
    const server = createAppServer({
      store,
      createAgent: () => ({
        model: {
          async respond() {
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
  });
});
