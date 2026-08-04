import type { TurnRepository } from "@town/agents";
import type { Id } from "@town/contracts";
import type { ToolExecutionRepository } from "@town/tools";
import type {
  AppServer,
  AppServerResponse,
  PersistentThreadStore,
  ThreadSnapshot,
} from "@town/harness";
import {
  RetryableRuntimeError,
  type ApprovalDecisionRepository,
  type RuntimeAdapter,
  type RuntimeAdapterContext,
  type RuntimeAdapterEvent,
} from "@town/runtime";

export interface HarnessExecutionContext {
  ownerId: Id<"user">;
  sessionId: Id<"runtime-session">;
  runId: Id<"session-run">;
  leaseToken: string;
  agentVersionId: Id<"agent-version">;
  execution: ToolExecutionRepository;
}

export function createHarnessRuntimeAdapter(input: {
  createServer: (
    ownerId: string,
    executionContext?: HarnessExecutionContext,
  ) => Promise<AppServer>;
  createStore: (ownerId: string) => PersistentThreadStore;
  turns: TurnRepository;
  toolExecution?: ToolExecutionRepository;
  approvalDecisions?: ApprovalDecisionRepository;
}): RuntimeAdapter {
  const retryableErrorCodes = new Set([
    "ECONNRESET",
    "ECONNREFUSED",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ETIMEDOUT",
    "EPIPE",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_READ_TIMEOUT",
  ]);
  const isRetryableError = (error: unknown): boolean => {
    const asError =
      error === null || typeof error !== "object" ? null : (error as Error & { code?: string });
    if (asError === null) return false;
    const code = asError.code;
    if (code !== undefined && retryableErrorCodes.has(code)) return true;
    const message = asError.message.toLowerCase();
    return (
      message.includes("timed out") ||
      message.includes("timeout") ||
      message.includes("network") ||
      message.includes("fetch failed")
    );
  };
  const dispatch = async (
    server: AppServer,
    request: Parameters<AppServer["dispatch"]>[0],
    retryMessage: string,
  ): Promise<AppServerResponse> => {
    try {
      return await server.dispatch(request);
    } catch (error) {
      if (isRetryableError(error))
        throw new RetryableRuntimeError(retryMessage);
      throw error;
    }
  };

  return {
    async *execute(
      context: RuntimeAdapterContext,
    ): AsyncIterable<RuntimeAdapterEvent> {
      if (context.signal.aborted) throw new Error("RUNTIME_ABORTED");
      const ownerId = context.session.ownerId;
      const threadId = context.session.threadId;
      const store = input.createStore(ownerId);
      const existing = await store.get(threadId);
      if (existing === undefined) {
        const snapshot: ThreadSnapshot = {
          threadId,
          agentVersionId: context.session.agentVersion.id,
          items: [],
          stepCount: 0,
          revision: 0,
        };
        await store.set(threadId, snapshot);
      } else if (existing.agentVersionId === undefined) {
        await store.set(threadId, {
          ...existing,
          agentVersionId: context.session.agentVersion.id,
        });
      }
      const pendingApproval = (await store.get(threadId))?.pendingApproval;
      const approvalDecision =
        pendingApproval === undefined || input.approvalDecisions === undefined
          ? null
          : await input.approvalDecisions.getPending({
              ownerId,
              sessionId: context.session.id,
              runId: context.run.id,
              approvalId: pendingApproval.callId,
            });
      yield { type: "phase", phase: "context_building" };
      if (pendingApproval !== undefined && approvalDecision === null) {
        yield { type: "phase", phase: "model_running" };
        yield {
          type: "waiting_approval",
          reason: "Approval is required before this durable run can continue.",
          approvalId: pendingApproval.callId,
        };
        return;
      }
      const server = await input.createServer(
        ownerId,
        input.toolExecution === undefined
          ? undefined
          : {
              ownerId,
              sessionId: context.session.id,
              runId: context.run.id,
              leaseToken: context.leaseToken,
              agentVersionId: context.session.agentVersion.id,
              execution: input.toolExecution,
            },
      );
      const initialized = await dispatch(
        server,
        {
          jsonrpc: "2.0",
          id: "runtime-initialize",
          method: "initialize",
          params: {},
        },
        "HARNESS_DISPATCH_RETRYABLE_INITIALIZE",
      );
      assertResponse(initialized, "Harness initialization failed.");
      const response =
        pendingApproval !== undefined && approvalDecision !== null
          ? await dispatch(
              server,
              {
                jsonrpc: "2.0",
                id: context.run.id,
                method: "approval/resolve",
                params: {
                  threadId,
                  approvalId: pendingApproval.callId,
                  decision: approvalDecision.decision,
                },
              },
              "HARNESS_DISPATCH_RETRYABLE_APPROVAL_RESOLVE",
            )
          : await dispatch(
              server,
              {
                jsonrpc: "2.0",
                id: context.run.id,
                method: "turn/start",
                params: {
                  threadId,
                  text:
                    context.run.inputResponse ??
                    (
                      await input.turns.get({
                        ownerId,
                        threadId,
                        turnId: context.run.triggeringTurnId,
                      })
                    ).text,
                },
              },
              "HARNESS_DISPATCH_RETRYABLE_TURN_START",
            );
      assertResponse(response, "Harness turn failed.");
      if (pendingApproval !== undefined && approvalDecision !== null)
        await input.approvalDecisions?.consume({
          ownerId,
          sessionId: context.session.id,
          runId: context.run.id,
          approvalId: pendingApproval.callId,
        });
      yield { type: "phase", phase: "model_running" };
      for (const notification of response.notifications ?? []) {
        if (notification.method === "approval/requested") {
          yield {
            type: "waiting_approval",
            reason: `Approval required for ${String(notification.params["toolName"] ?? "tool action")}.`,
            approvalId: String(
              notification.params["approvalId"] ??
                notification.params["callId"] ??
                "",
            ),
          };
          return;
        }
        if (notification.method !== "item/completed") continue;
        const item = notification.params["item"];
        if (
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "assistant_message" &&
          "text" in item &&
          typeof item.text === "string"
        ) {
          yield { type: "assistant_output", text: item.text, mentions: [] };
        }
      }
      yield { type: "phase", phase: "observation_recorded" };
    },
  };
}

function assertResponse(response: AppServerResponse, message: string): void {
  if (response.error !== undefined) {
    if (response.error.code === -32603)
      throw new RetryableRuntimeError(`${message} INTERNAL_ERROR`);
    throw new Error(`${message} ${response.error.message}`);
  }
}
