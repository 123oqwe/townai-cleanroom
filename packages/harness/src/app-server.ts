import { randomUUID } from "node:crypto";

import { newId } from "@town/contracts";
import { z } from "zod";

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
  revision: number;
  leaseOwner?: string;
  leaseExpiresAt?: number;
  activeTool?: {
    callId: string;
    toolName: string;
    arguments: Record<string, unknown>;
  };
}

const harnessItemSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user_message"), text: z.string() }),
  z.object({
    type: z.literal("assistant_message"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("assistant_tool_call"),
    callId: z.string().min(1),
    toolName: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()),
    providerItem: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    type: z.literal("tool_result"),
    callId: z.string().min(1),
    toolName: z.string().min(1),
    output: z.string(),
  }),
  z.object({
    type: z.literal("provider_item"),
    item: z.record(z.string(), z.unknown()),
  }),
]);

export const threadSnapshotSchema = z.object({
  threadId: z.string().min(1),
  items: z.array(harnessItemSchema),
  pendingApproval: z
    .object({
      callId: z.string().min(1),
      toolName: z.string().min(1),
      arguments: z.record(z.string(), z.unknown()),
    })
    .optional(),
  stepCount: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  leaseOwner: z.string().min(1).optional(),
  leaseExpiresAt: z.number().finite().optional(),
  activeTool: z
    .object({
      callId: z.string().min(1),
      toolName: z.string().min(1),
      arguments: z.record(z.string(), z.unknown()),
    })
    .optional(),
});

export type ThreadStore = Map<string, ThreadSnapshot>;

export interface PersistentThreadStore {
  get(
    threadId: string,
  ): ThreadSnapshot | undefined | Promise<ThreadSnapshot | undefined>;
  set(threadId: string, snapshot: ThreadSnapshot): unknown | Promise<unknown>;
  compareAndSet: (
    threadId: string,
    expected: { revision: number; leaseOwner?: string; takeover?: boolean },
    snapshot: ThreadSnapshot,
  ) => boolean | Promise<boolean>;
  now: () => number | Promise<number>;
  acquireLease?: (
    threadId: string,
    expectedRevision: number,
    leaseOwner: string,
    leaseMs: number,
  ) => ThreadSnapshot | undefined | Promise<ThreadSnapshot | undefined>;
}

export interface AppServerRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params: Record<string, unknown>;
}

export interface AppServerResponse {
  jsonrpc: "2.0";
  id: string | number | null;
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
  leaseLost: boolean;
  activeTool?: ThreadSnapshot["activeTool"];
}

function errorResponse(
  request: AppServerRequest,
  code: number,
  message: string,
  notifications?: Array<{
    jsonrpc: "2.0";
    method: string;
    params: Record<string, unknown>;
  }>,
): AppServerResponse {
  return {
    jsonrpc: "2.0",
    id: request.id,
    error: { code, message },
    ...(notifications === undefined ? {} : { notifications }),
  };
}

function invalidParams(
  request: AppServerRequest,
  message: string,
): AppServerResponse {
  return errorResponse(request, -32602, message);
}

export function createAppServer(input: {
  store: ThreadStore | PersistentThreadStore;
  leaseMs?: number;
  createAgent: (threadId: string) => {
    model: ModelPort;
    tools: readonly ToolPort[];
  };
}) {
  const store: PersistentThreadStore =
    input.store instanceof Map
      ? (() => {
          const mapStore = input.store as ThreadStore;
          return {
            get: (threadId) => mapStore.get(threadId),
            set: (threadId, snapshot) => mapStore.set(threadId, snapshot),
            compareAndSet: (threadId, expected, snapshot) => {
              const current = mapStore.get(threadId);
              if (
                current === undefined ||
                current.revision !== expected.revision ||
                current.leaseOwner !== expected.leaseOwner
              )
                return false;
              mapStore.set(threadId, snapshot);
              return true;
            },
            now: () => Date.now(),
            acquireLease: (threadId, expectedRevision, leaseOwner, leaseMs) => {
              const current = mapStore.get(threadId);
              if (
                current === undefined ||
                current.revision !== expectedRevision ||
                (current.leaseOwner !== undefined &&
                  (current.leaseExpiresAt ?? Number.POSITIVE_INFINITY) >
                    Date.now())
              )
                return undefined;
              const claimed = {
                ...current,
                revision: current.revision + 1,
                leaseOwner,
                leaseExpiresAt: Date.now() + leaseMs,
              };
              mapStore.set(threadId, claimed);
              return claimed;
            },
          };
        })()
      : input.store;
  let initialized = false;
  const serverId = randomUUID();
  const leaseMs = input.leaseMs ?? 30_000;
  const runtimes = new Map<string, ThreadRuntime>();

  async function writeSnapshot(
    threadId: string,
    expected: { revision: number; leaseOwner?: string; takeover?: boolean },
    snapshot: ThreadSnapshot,
  ): Promise<void> {
    if (!(await store.compareAndSet(threadId, expected, snapshot)))
      throw new Error("THREAD_CONFLICT: thread state changed while running.");
  }

  async function persist(
    runtime: ThreadRuntime,
    keepLease = true,
  ): Promise<void> {
    if (runtime.leaseLost)
      throw new Error("THREAD_CONFLICT: runtime lease was lost.");
    const latest = await store.get(runtime.snapshot.threadId);
    if (
      latest === undefined ||
      latest.revision !== runtime.snapshot.revision ||
      latest.leaseOwner !== serverId
    )
      throw new Error("THREAD_CONFLICT: thread state changed while running.");
    const snapshot: ThreadSnapshot = {
      threadId: runtime.snapshot.threadId,
      items: [...runtime.harness.getItems()],
      stepCount: runtime.harness.getStepCount(),
      revision: latest.revision + 1,
      ...(keepLease
        ? {
            leaseOwner: serverId,
            leaseExpiresAt: (await store.now()) + leaseMs,
          }
        : {}),
      ...(runtime.activeTool === undefined
        ? {}
        : { activeTool: runtime.activeTool }),
    };
    const pendingApproval = runtime.harness.getPendingApproval();
    if (pendingApproval !== undefined)
      snapshot.pendingApproval = pendingApproval;
    runtime.snapshot = snapshot;
    await writeSnapshot(
      runtime.snapshot.threadId,
      { revision: latest.revision, leaseOwner: serverId },
      runtime.snapshot,
    );
  }

  async function claim(runtime: ThreadRuntime): Promise<void> {
    if (store.acquireLease !== undefined) {
      const claimed = await store.acquireLease(
        runtime.snapshot.threadId,
        runtime.snapshot.revision,
        serverId,
        leaseMs,
      );
      if (claimed === undefined)
        throw new Error("THREAD_CONFLICT: thread is stale or busy.");
      runtime.snapshot = claimed;
      return;
    }
    const latest = await store.get(runtime.snapshot.threadId);
    if (latest === undefined) throw new Error("THREAD_NOT_FOUND");
    if (
      latest.revision !== runtime.snapshot.revision ||
      (latest.leaseOwner !== undefined &&
        (latest.leaseExpiresAt ?? Number.POSITIVE_INFINITY) >
          (await store.now()))
    )
      throw new Error("THREAD_CONFLICT: thread is stale or busy.");
    const claimed: ThreadSnapshot = {
      ...latest,
      revision: latest.revision + 1,
      leaseOwner: serverId,
      leaseExpiresAt: (await store.now()) + leaseMs,
    };
    await writeSnapshot(
      runtime.snapshot.threadId,
      {
        revision: latest.revision,
        takeover: true,
        ...(latest.leaseOwner === undefined
          ? {}
          : { leaseOwner: latest.leaseOwner }),
      },
      claimed,
    );
    runtime.snapshot = claimed;
  }

  async function release(runtime: ThreadRuntime): Promise<void> {
    const latest = await store.get(runtime.snapshot.threadId);
    if (latest?.leaseOwner !== serverId) return;
    const released: ThreadSnapshot = {
      ...latest,
      revision: latest.revision + 1,
    };
    delete released.leaseOwner;
    delete released.leaseExpiresAt;
    await writeSnapshot(
      runtime.snapshot.threadId,
      { revision: latest.revision, leaseOwner: serverId },
      released,
    );
    runtime.snapshot = released;
  }

  async function renew(runtime: ThreadRuntime): Promise<void> {
    const latest = await store.get(runtime.snapshot.threadId);
    if (
      latest?.revision !== runtime.snapshot.revision ||
      latest.leaseOwner !== serverId
    ) {
      runtime.leaseLost = true;
      return;
    }
    const renewed: ThreadSnapshot = {
      ...latest,
      revision: latest.revision + 1,
      leaseOwner: serverId,
      leaseExpiresAt: (await store.now()) + leaseMs,
    };
    await writeSnapshot(
      runtime.snapshot.threadId,
      { revision: latest.revision, leaseOwner: serverId },
      renewed,
    );
    runtime.snapshot = renewed;
  }

  async function getRuntime(
    threadId: string,
  ): Promise<ThreadRuntime | undefined> {
    const existing = runtimes.get(threadId);
    if (existing !== undefined) return existing;
    const snapshot = await store.get(threadId);
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
    const runtime: ThreadRuntime = {
      snapshot,
      harness,
      busy: false,
      leaseLost: false,
      ...(snapshot.activeTool === undefined
        ? {}
        : { activeTool: snapshot.activeTool }),
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
      case "turn_rejected":
        return [
          notification("turn/completed", {
            threadId,
            status: "rejected",
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
    const runtime = await getRuntime(threadId);
    if (runtime === undefined)
      return errorResponse(request, -32004, "thread not found");
    if (runtime.busy) return errorResponse(request, -32005, "thread is busy");
    try {
      await claim(runtime);
    } catch (error) {
      runtimes.delete(threadId);
      return errorResponse(
        request,
        -32005,
        error instanceof Error ? error.message : "thread is busy",
      );
    }

    runtime.busy = true;
    runtime.leaseLost = false;
    const heartbeat = setInterval(
      () => {
        void enqueueStateWrite(() => renew(runtime)).catch(() => {
          runtime.leaseLost = true;
        });
      },
      Math.max(1, Math.floor(leaseMs / 3)),
    );
    heartbeat.unref?.();
    const notifications: Array<ReturnType<typeof notification>> = [];
    let stateWrite = Promise.resolve();
    const enqueueStateWrite = (task: () => Promise<void>): Promise<void> => {
      const next = stateWrite.then(task);
      stateWrite = next.catch(() => undefined);
      return next;
    };
    const eventWrite = (event: HarnessEvent): Promise<void> => {
      const mapped = eventNotifications(threadId, event);
      return enqueueStateWrite(async () => {
        await persist(runtime);
        notifications.push(...mapped);
      });
    };
    runtime.harness.setEmitter((event: HarnessEvent) => {
      if (event.type === "tool_started")
        runtime.activeTool = {
          callId: event.callId,
          toolName: event.toolName,
          arguments: event.arguments,
        };
      if (event.type === "tool_succeeded" || event.type === "tool_failed")
        runtime.activeTool = undefined;
      return eventWrite(event).catch(() => {
        runtime.leaseLost = true;
        throw new Error("THREAD_CONFLICT: durable event persistence failed.");
      });
    });
    try {
      const result = await operation(runtime, notifications);
      await stateWrite;
      await enqueueStateWrite(() => persist(runtime));
      return { jsonrpc: "2.0", id: request.id, result, notifications };
    } catch (error) {
      await stateWrite;
      try {
        await enqueueStateWrite(() => persist(runtime));
      } catch {
        // Preserve the original operation error and return it through JSON-RPC.
      }
      const message =
        error instanceof Error ? error.message : "Request failed.";
      const code =
        runtime.leaseLost || message.startsWith("THREAD_")
          ? -32005
          : message.startsWith("HARNESS_")
            ? -32010
            : -32000;
      return errorResponse(request, code, message, notifications);
    } finally {
      clearInterval(heartbeat);
      try {
        await enqueueStateWrite(() => persist(runtime, true));
        await enqueueStateWrite(() => release(runtime));
      } catch {
        // A stale owner cannot overwrite a newer store revision.
      }
      runtime.busy = false;
    }
  }

  return {
    async dispatch(request: AppServerRequest): Promise<AppServerResponse> {
      try {
        if (
          request === null ||
          typeof request !== "object" ||
          request.jsonrpc !== "2.0" ||
          (typeof request.id !== "string" && typeof request.id !== "number") ||
          typeof request.method !== "string" ||
          request.params === null ||
          typeof request.params !== "object" ||
          Array.isArray(request.params)
        ) {
          return {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32600, message: "invalid JSON-RPC request" },
          };
        }
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
          await store.set(threadId, {
            threadId,
            items: [],
            stepCount: 0,
            revision: 0,
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
            if (runtime.snapshot.activeTool !== undefined)
              throw new Error(
                "HARNESS_EXECUTION_RECOVERY_REQUIRED: an interrupted tool execution must be reconciled before continuing.",
              );
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
              if (runtime.snapshot.activeTool !== undefined)
                throw new Error(
                  "HARNESS_EXECUTION_RECOVERY_REQUIRED: an interrupted tool execution must be reconciled before continuing.",
                );
              if (runtime.harness.getPendingApproval()?.callId !== approvalId)
                throw new Error(
                  "HARNESS_APPROVAL_NOT_FOUND: the approval is not pending.",
                );
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
        if (request.method === "execution/reconcile") {
          const threadId = request.params["threadId"];
          const callId = request.params["callId"];
          const output = request.params["output"];
          if (
            typeof threadId !== "string" ||
            typeof callId !== "string" ||
            typeof output !== "string" ||
            output.trim() === ""
          )
            return invalidParams(
              request,
              "threadId, callId, and non-empty output are required",
            );
          return withRuntime(request, threadId, async (runtime) => {
            const active = runtime.snapshot.activeTool;
            if (active === undefined || active.callId !== callId)
              throw new Error(
                "HARNESS_EXECUTION_NOT_FOUND: no matching interrupted tool execution.",
              );
            await runtime.harness.recordInterruptedToolResult({
              callId,
              toolName: active.toolName,
              output,
            });
            runtime.activeTool = undefined;
            delete runtime.snapshot.activeTool;
            return { kind: "reconciled", callId };
          });
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
