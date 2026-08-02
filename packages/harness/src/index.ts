import { z } from "zod";

const toolArgumentsSchema = z.record(z.string(), z.unknown());
const toolResultSchema = z
  .object({ kind: z.literal("result"), output: z.string() })
  .strict();

export type HarnessItem =
  | { type: "user_message"; text: string }
  | {
      type: "assistant_tool_call";
      callId: string;
      toolName: string;
      arguments: Record<string, unknown>;
    }
  | { type: "tool_result"; callId: string; toolName: string; output: string }
  | { type: "assistant_message"; text: string }
  | { type: "provider_item"; item: Record<string, unknown> };

export interface ModelPort {
  respond(input: { items: HarnessItem[] }): Promise<
    | {
        kind: "tool_call";
        callId: string;
        toolName: string;
        arguments: Record<string, unknown>;
        providerItems?: Array<{
          type: "provider_item";
          item: Record<string, unknown>;
        }>;
      }
    | { kind: "final"; text: string }
  >;
}

export interface ToolPort {
  name: string;
  requiresApproval?: boolean;
  execute(
    arguments_: Record<string, unknown>,
  ): Promise<{ kind: "result"; output: string }>;
}

export type HarnessEvent =
  | { type: "turn_started"; userText: string }
  | {
      type: "assistant_tool_call";
      callId: string;
      toolName: string;
      arguments: Record<string, unknown>;
    }
  | { type: "tool_started"; callId: string; toolName: string }
  | { type: "tool_succeeded"; callId: string; toolName: string; output: string }
  | { type: "tool_failed"; callId: string; toolName: string; error: string }
  | { type: "approval_requested"; approvalId: string; toolName: string }
  | { type: "approval_rejected"; approvalId: string }
  | { type: "turn_rejected"; approvalId: string }
  | { type: "assistant_message"; text: string }
  | { type: "turn_completed"; text: string };

export type HarnessResult =
  | { kind: "completed"; text: string }
  | { kind: "paused"; approvalId: string; toolName: string }
  | { kind: "rejected" };

interface PendingApproval {
  callId: string;
  tool: ToolPort;
  arguments: Record<string, unknown>;
}

export interface PendingApprovalSnapshot {
  callId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export function createHarness(input: {
  model: ModelPort;
  tools: readonly ToolPort[];
  emit?: (event: HarnessEvent) => void;
  maxSteps?: number;
  initialItems?: readonly HarnessItem[];
  initialPendingApproval?: PendingApprovalSnapshot;
  initialStepCount?: number;
}) {
  const tools = new Map(input.tools.map((tool) => [tool.name, tool]));
  let emit = input.emit ?? (() => undefined);
  const maxSteps = input.maxSteps ?? 32;
  let items: HarnessItem[] = [...(input.initialItems ?? [])];
  let pending: PendingApproval | undefined;
  let stepCount = input.initialStepCount ?? 0;
  if (input.initialPendingApproval !== undefined) {
    const tool = tools.get(input.initialPendingApproval.toolName);
    if (tool === undefined) {
      throw new Error(
        `HARNESS_APPROVAL_TOOL_NOT_FOUND: ${input.initialPendingApproval.toolName}`,
      );
    }
    pending = {
      callId: input.initialPendingApproval.callId,
      tool,
      arguments: toolArgumentsSchema.parse(
        input.initialPendingApproval.arguments,
      ),
    };
  }

  function add(event: HarnessEvent): void {
    emit(event);
  }

  async function continueLoop(): Promise<HarnessResult> {
    while (stepCount < maxSteps) {
      stepCount += 1;
      const response = await input.model.respond({ items: [...items] });
      if (response.kind === "final") {
        items = [...items, { type: "assistant_message", text: response.text }];
        add({ type: "assistant_message", text: response.text });
        add({ type: "turn_completed", text: response.text });
        return { kind: "completed", text: response.text };
      }

      const arguments_ = toolArgumentsSchema.parse(response.arguments);
      const tool = tools.get(response.toolName);
      if (response.providerItems !== undefined)
        items = [...items, ...response.providerItems];
      items = [
        ...items,
        {
          type: "assistant_tool_call",
          callId: response.callId,
          toolName: response.toolName,
          arguments: arguments_,
        },
      ];
      add({
        type: "assistant_tool_call",
        callId: response.callId,
        toolName: response.toolName,
        arguments: arguments_,
      });
      if (tool === undefined) {
        const error = `Unknown tool: ${response.toolName}`;
        items = [
          ...items,
          {
            type: "tool_result",
            callId: response.callId,
            toolName: response.toolName,
            output: error,
          },
        ];
        add({
          type: "tool_failed",
          callId: response.callId,
          toolName: response.toolName,
          error,
        });
        continue;
      }
      if (tool.requiresApproval === true) {
        pending = { callId: response.callId, tool, arguments: arguments_ };
        add({
          type: "approval_requested",
          approvalId: response.callId,
          toolName: response.toolName,
        });
        return {
          kind: "paused",
          approvalId: response.callId,
          toolName: response.toolName,
        };
      }
      await executeTool(response.callId, tool, arguments_);
    }
    throw new Error(
      "HARNESS_STEP_LIMIT: the agent loop exceeded its step limit.",
    );
  }

  async function executeTool(
    callId: string,
    tool: ToolPort,
    arguments_: Record<string, unknown>,
  ): Promise<void> {
    add({ type: "tool_started", callId, toolName: tool.name });
    try {
      const result = toolResultSchema.parse(await tool.execute(arguments_));
      items = [
        ...items,
        {
          type: "tool_result",
          callId,
          toolName: tool.name,
          output: result.output,
        },
      ];
      add({
        type: "tool_succeeded",
        callId,
        toolName: tool.name,
        output: result.output,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Tool execution failed.";
      items = [
        ...items,
        { type: "tool_result", callId, toolName: tool.name, output: message },
      ];
      add({ type: "tool_failed", callId, toolName: tool.name, error: message });
    }
  }

  return {
    setEmitter(next: (event: HarnessEvent) => void): void {
      emit = next;
    },
    async run(runInput: { userText: string }): Promise<HarnessResult> {
      if (pending !== undefined)
        throw new Error(
          "HARNESS_APPROVAL_PENDING: resolve the pending approval first.",
        );
      stepCount = 0;
      items = [...items, { type: "user_message", text: runInput.userText }];
      add({ type: "turn_started", userText: runInput.userText });
      return continueLoop();
    },
    async resume(decision: {
      approvalId: string;
      decision: "approve" | "reject";
    }): Promise<HarnessResult> {
      if (pending === undefined || pending.callId !== decision.approvalId)
        throw new Error(
          "HARNESS_APPROVAL_NOT_FOUND: the approval is not pending.",
        );
      const current = pending;
      pending = undefined;
      if (decision.decision === "reject") {
        const output = "Approval rejected.";
        items = [
          ...items,
          {
            type: "tool_result",
            callId: current.callId,
            toolName: current.tool.name,
            output,
          },
        ];
        add({ type: "approval_rejected", approvalId: decision.approvalId });
        add({
          type: "tool_failed",
          callId: current.callId,
          toolName: current.tool.name,
          error: output,
        });
        add({ type: "turn_rejected", approvalId: decision.approvalId });
        return { kind: "rejected" };
      }
      await executeTool(current.callId, current.tool, current.arguments);
      return continueLoop();
    },
    getItems(): readonly HarnessItem[] {
      return [...items];
    },
    getPendingApproval(): PendingApprovalSnapshot | undefined {
      if (pending === undefined) return undefined;
      return {
        callId: pending.callId,
        toolName: pending.tool.name,
        arguments: { ...pending.arguments },
      };
    },
    getStepCount(): number {
      return stepCount;
    },
  };
}

export type Harness = ReturnType<typeof createHarness>;

export * from "./app-server.js";
export * from "./responses.js";
