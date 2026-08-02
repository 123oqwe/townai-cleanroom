import { newId } from "@town/contracts";

import {
  createHarness,
  type Harness,
  type HarnessEvent,
  type HarnessItem,
  type ModelPort,
  type ToolPort,
} from "./index.js";

export interface ThreadSnapshot {
  threadId: string;
  items: HarnessItem[];
}

export type ThreadStore = Map<string, ThreadSnapshot>;
export interface AppServerRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params: Record<string, unknown>;
}

export interface AppServerResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
  notifications?: Array<{
    jsonrpc: "2.0";
    method: string;
    params: Record<string, unknown>;
  }>;
}

interface ThreadRuntime {
  snapshot: ThreadSnapshot;
  harness: Harness;
}

function errorResponse(
  request: AppServerRequest,
  code: number,
  message: string,
): AppServerResponse {
  return { jsonrpc: "2.0", id: request.id, error: { code, message } };
}

export function createAppServer(input: {
  store: ThreadStore;
  createAgent: (threadId: string) => {
    model: ModelPort;
    tools: readonly ToolPort[];
  };
}) {
  let initialized = false;
  const runtimes = new Map<string, ThreadRuntime>();

  function getRuntime(threadId: string): ThreadRuntime | undefined {
    const existing = runtimes.get(threadId);
    if (existing !== undefined) return existing;
    const snapshot = input.store.get(threadId);
    if (snapshot === undefined) return undefined;
    const runtime: ThreadRuntime = {
      snapshot,
      harness: createHarness({
        ...input.createAgent(threadId),
        emit: () => undefined,
      }),
    };
    runtimes.set(threadId, runtime);
    return runtime;
  }

  function notification(method: string, params: Record<string, unknown>) {
    return { jsonrpc: "2.0" as const, method, params };
  }

  function eventNotifications(
    threadId: string,
    event: HarnessEvent,
  ): Array<ReturnType<typeof notification>> {
    switch (event.type) {
      case "turn_started":
        return [
          notification("turn/started", { threadId, text: event.userText }),
        ];
      case "assistant_tool_call":
        return [notification("item/started", { threadId, item: event })];
      case "tool_started":
        return [notification("item/started", { threadId, item: event })];
      case "tool_succeeded":
      case "tool_failed":
        return [notification("item/completed", { threadId, item: event })];
      case "approval_requested":
        return [
          notification("approval/requested", {
            threadId,
            approvalId: event.approvalId,
            toolName: event.toolName,
          }),
        ];
      case "approval_rejected":
        return [
          notification("approval/rejected", {
            threadId,
            approvalId: event.approvalId,
          }),
        ];
      case "assistant_message":
        return [
          notification("item/started", { threadId, item: event }),
          notification("item/completed", { threadId, item: event }),
        ];
      case "turn_completed":
        return [notification("turn/completed", { threadId, text: event.text })];
    }
  }

  return {
    async dispatch(request: AppServerRequest): Promise<AppServerResponse> {
      if (!initialized && request.method !== "initialize")
        return errorResponse(
          request,
          -32001,
          "initialize must be called first",
        );
      if (request.method === "initialize") {
        if (initialized)
          return errorResponse(
            request,
            -32600,
            "initialize may only be called once",
          );
        initialized = true;
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            protocolVersion: "1",
            capabilities: {
              threads: true,
              approvals: true,
              notifications: true,
            },
          },
        };
      }
      if (request.method === "thread/start") {
        const threadId = newId<"thread">();
        input.store.set(threadId, { threadId, items: [] });
        return { jsonrpc: "2.0", id: request.id, result: { threadId } };
      }
      if (request.method === "turn/start") {
        const threadId = String(request.params["threadId"] ?? "");
        const text = String(request.params["text"] ?? "");
        const runtime = getRuntime(threadId);
        if (runtime === undefined)
          return errorResponse(request, -32004, "thread not found");
        const notifications: Array<ReturnType<typeof notification>> = [];
        const harness = createHarness({
          ...input.createAgent(threadId),
          emit: (event: HarnessEvent) =>
            notifications.push(...eventNotifications(threadId, event)),
        });
        runtime.harness = harness;
        const result = await harness.run({ userText: text });
        runtime.snapshot = { threadId, items: [...harness.getItems()] };
        input.store.set(threadId, runtime.snapshot);
        return { jsonrpc: "2.0", id: request.id, result, notifications };
      }
      if (request.method === "approval/resolve") {
        const threadId = String(request.params["threadId"] ?? "");
        const runtime = getRuntime(threadId);
        if (runtime === undefined)
          return errorResponse(request, -32004, "thread not found");
        const approvalId = String(request.params["approvalId"] ?? "");
        const decision =
          request.params["decision"] === "approve" ? "approve" : "reject";
        const notifications: Array<ReturnType<typeof notification>> = [];
        const original = runtime.harness;
        // Attach a temporary event bridge while preserving the pending approval in the live core.
        const result = await original.resume({ approvalId, decision });
        notifications.push(
          notification("approval/resolved", { threadId, approvalId, decision }),
        );
        runtime.snapshot = { threadId, items: [...original.getItems()] };
        input.store.set(threadId, runtime.snapshot);
        return { jsonrpc: "2.0", id: request.id, result, notifications };
      }
      return errorResponse(
        request,
        -32601,
        `unknown method: ${request.method}`,
      );
    },
  };
}

export type AppServer = ReturnType<typeof createAppServer>;
