import type { TurnRepository } from "@town/agents";
import type {
  AppServer,
  AppServerResponse,
  PersistentThreadStore,
  ThreadSnapshot,
} from "@town/harness";
import type {
  ApprovalDecisionRepository,
  RuntimeAdapter,
  RuntimeAdapterContext,
  RuntimeAdapterEvent,
} from "@town/runtime";

export function createHarnessRuntimeAdapter(input: {
  createServer: (ownerId: string) => Promise<AppServer>;
  createStore: (ownerId: string) => PersistentThreadStore;
  turns: TurnRepository;
  approvalDecisions?: ApprovalDecisionRepository;
}): RuntimeAdapter {
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
      const server = await input.createServer(ownerId);
      const initialized = await server.dispatch({
        jsonrpc: "2.0",
        id: "runtime-initialize",
        method: "initialize",
        params: {},
      });
      assertResponse(initialized, "Harness initialization failed.");
      const response =
        pendingApproval !== undefined && approvalDecision !== null
          ? await server.dispatch({
              jsonrpc: "2.0",
              id: context.run.id,
              method: "approval/resolve",
              params: {
                threadId,
                approvalId: pendingApproval.callId,
                decision: approvalDecision.decision,
              },
            })
          : await server.dispatch({
              jsonrpc: "2.0",
              id: context.run.id,
              method: "turn/start",
              params: {
                threadId,
                text: (
                  await input.turns.get({
                    ownerId,
                    threadId,
                    turnId: context.run.triggeringTurnId,
                  })
                ).text,
              },
            });
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
    throw new Error(`${message} ${response.error.message}`);
  }
}
