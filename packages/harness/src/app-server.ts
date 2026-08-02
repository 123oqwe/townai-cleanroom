import { newId } from "@town/contracts";

import {
  createHarness,
  type Harness,
  type HarnessEvent,
  type HarnessItem,
  type ModelPort,
  type PendingApprovalSnapshot,
  type ToolPort,
} from "./index.js";

export interface ThreadSnapshot {
  threadId: string;
  items: HarnessItem[];
  pendingApproval?: PendingApprovalSnapshot;
  stepCount: number;
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
  busy: boolean;
}

function errorResponse(
  request: AppServerRequest,
  code: number,
  message: string,
): AppServerResponse {
  return { jsonrpc: "2.0", id: request.id, error: { code, message } };
}

function invalidParams(
  request: AppServerRequest,
  message: string,
): AppServerResponse {
  return errorResponse(request, -32602, message);
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

  function persist(runtime: ThreadRuntime): void {
    const snapshot: ThreadSnapshot = {
      threadId: runtime.snapshot.threadId,
      items: [...runtime.harness.getItems()],
      stepCount: runtime.harness.getStepCount(),
    };
    const pendingApproval = runtime.harness.getPendingApproval();
    if (pendingApproval !== undefined)
      snapshot.pendingApproval = pendingApproval;
    runtime.snapshot = snapshot;
    input.store.set(runtime.snapshot.threadId, runtime.snapshot);
  }

  function getRuntime(threadId: string): ThreadRuntime | undefined {
    const existing = runtimes.get(threadId);
    if (existing !== undefined) return existing;
    const snapshot = input.store.get(threadId);
    if (snapshot === undefined) return undefined;
    const harnessInput = {
      ...input.createAgent(threadId),
      initialItems: snapshot.items,
      initialStepCount: snapshot.stepCount,
      emit: () => undefined,
      ...(snapshot.pendingApproval === undefined
        ? {}
        : { initialPendingApproval: snapshot.pendingApproval }),
    };
    const harness = createHarness(harnessInput);
    const runtime: ThreadRuntime = { snapshot, harness, busy: false };
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

  async function withRuntime(
    request: AppServerRequest,
    threadId: string,
    operation: (
      runtime: ThreadRuntime,
      notifications: Array<ReturnType<typeof notification>>,
    ) => Promise<unknown>,
  ): Promise<AppServerResponse> {
    const runtime = getRuntime(threadId);
    if (runtime === undefined)
      return errorResponse(request, -32004, "thread not found");
    if (runtime.busy) return errorResponse(request, -32005, "thread is busy");

    runtime.busy = true;
    const notifications: Array<ReturnType<typeof notification>> = [];
    runtime.harness.setEmitter((event: HarnessEvent) => {
      notifications.push(...eventNotifications(threadId, event));
      persist(runtime);
    });
    try {
      const result = await operation(runtime, notifications);
      persist(runtime);
      return { jsonrpc: "2.0", id: request.id, result, notifications };
    } catch (error) {
      persist(runtime);
      const message =
        error instanceof Error ? error.message : "Request failed.";
      const code = message.startsWith("HARNESS_") ? -32010 : -32000;
      return errorResponse(request, code, message);
    } finally {
      runtime.busy = false;
    }
  }

  return {
    async dispatch(request: AppServerRequest): Promise<AppServerResponse> {
      try {
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
          input.store.set(threadId, {
            threadId,
            items: [],
            stepCount: 0,
          });
          return { jsonrpc: "2.0", id: request.id, result: { threadId } };
        }
        if (request.method === "turn/start") {
          const threadId = request.params["threadId"];
          const text = request.params["text"];
          if (
            typeof threadId !== "string" ||
            typeof text !== "string" ||
            text.trim() === ""
          )
            return invalidParams(
              request,
              "threadId and non-empty text are required",
            );
          return withRuntime(request, threadId, async (runtime) => {
            if (runtime.harness.getPendingApproval() !== undefined)
              throw new Error(
                "HARNESS_APPROVAL_PENDING: resolve the pending approval first.",
              );
            return runtime.harness.run({ userText: text });
          });
        }
        if (request.method === "approval/resolve") {
          const threadId = request.params["threadId"];
          const approvalId = request.params["approvalId"];
          const decision = request.params["decision"];
          if (
            typeof threadId !== "string" ||
            typeof approvalId !== "string" ||
            (decision !== "approve" && decision !== "reject")
          )
            return invalidParams(
              request,
              "threadId, approvalId, and decision=approve|reject are required",
            );
          return withRuntime(
            request,
            threadId,
            async (runtime, notifications) => {
              notifications.unshift(
                notification("approval/resolved", {
                  threadId,
                  approvalId,
                  decision,
                }),
              );
              return runtime.harness.resume({ approvalId, decision });
            },
          );
        }
        return errorResponse(
          request,
          -32601,
          `unknown method: ${request.method}`,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Request failed.";
        return errorResponse(request, -32000, message);
      }
    },
  };
}

export type AppServer = ReturnType<typeof createAppServer>;
