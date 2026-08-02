import type { ThreadMention } from "@town/agents";

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
      mentions: ThreadMention[];
    }
  | {
      type: "waiting_user_input";
      reason: string;
    };

export interface RuntimeAdapterContext {
  session: RuntimeSession;
  run: SessionRun;
  signal: AbortSignal;
}

export interface RuntimeAdapter {
  execute(context: RuntimeAdapterContext): AsyncIterable<RuntimeAdapterEvent>;
}
