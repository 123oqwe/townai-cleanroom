import type { TurnMentionInput } from "@town/agents";

import type { RuntimeSession, SessionRun } from "./types.js";

export type RuntimeAdapterEvent =
  | {
      type: "tool_call_proposed";
      callId: string;
      toolName: string;
      arguments: Record<string, unknown>;
      stepKey: string;
    }
  | {
      type: "phase";
      phase:
        | "context_building"
        | "model_running"
        | "policy_check"
        | "observation_recorded";
    }
  | {
      type: "assistant_output";
      text: string;
      mentions: TurnMentionInput[];
    }
  | {
      type: "policy_decided";
      callId: string;
      decision: "allow" | "approval_required" | "deny";
      riskFlags?: string[];
    }
  | {
      type: "waiting_user_input";
      reason: string;
    }
  | {
      type: "waiting_approval";
      reason: string;
      approvalId?: string;
    }
  | {
      type: "tool_started";
      callId: string;
      toolName: string;
      arguments: Record<string, unknown>;
    }
  | {
      type: "tool_succeeded";
      callId: string;
      toolName: string;
      output: string;
    }
  | {
      type: "tool_failed";
      callId: string;
      toolName: string;
      error: string;
    }
  | {
      type: "approval_requested";
      approvalId: string;
      toolName: string;
    }
  | {
      type: "approval_resolved";
      approvalId: string;
      toolName: string;
      decision: "approve" | "reject" | "expired";
    };

export interface RuntimeAdapterContext {
  session: RuntimeSession;
  run: SessionRun;
  leaseToken: string;
  signal: AbortSignal;
}

export interface RuntimeAdapter {
  execute(context: RuntimeAdapterContext): AsyncIterable<RuntimeAdapterEvent>;
}
