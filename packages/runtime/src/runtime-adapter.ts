import type { TurnMentionInput } from "@town/agents";

import type { RuntimeSession, SessionRun } from "./types.js";

export type RuntimeAdapterEvent =
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
      type: "waiting_user_input";
      reason: string;
    }
  | {
      type: "waiting_approval";
      reason: string;
      approvalId?: string;
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
