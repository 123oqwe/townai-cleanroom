import { describe, expect, it } from "vitest";
import {
  createHarness,
  type HarnessEvent,
  type ModelPort,
  type ToolPort,
} from "../src/index.js";

describe("Codex-style harness loop", () => {
  it("repeats model and tool turns until a final assistant message", async () => {
    const requests: string[] = [];
    const model: ModelPort = {
      async respond(input) {
        requests.push(input.items.at(-1)?.type ?? "");
        if (requests.length === 1) {
          return {
            kind: "tool_call",
            callId: "call-1",
            toolName: "read_context",
            arguments: { key: "focus" },
          };
        }
        return { kind: "final", text: "The focus is shipping." };
      },
    };
    const tool: ToolPort = {
      name: "read_context",
      async execute(args) {
        return { kind: "result", output: `value:${String(args["key"])}` };
      },
    };
    const events: HarnessEvent[] = [];
    const result = await createHarness({
      model,
      tools: [tool],
      emit: (event) => events.push(event),
    }).run({
      userText: "What is the focus?",
    });

    expect(result).toEqual({
      kind: "completed",
      text: "The focus is shipping.",
    });
    expect(events.map((event) => event.type)).toEqual([
      "turn_started",
      "assistant_tool_call",
      "tool_started",
      "tool_succeeded",
      "assistant_message",
      "turn_completed",
    ]);
    expect(requests).toEqual(["user_message", "tool_result"]);
  });

  it("pauses before an approval-required tool and resumes with the decision", async () => {
    let phase = 0;
    const model: ModelPort = {
      async respond() {
        phase += 1;
        return phase === 1
          ? {
              kind: "tool_call",
              callId: "call-2",
              toolName: "send_email",
              arguments: { to: "person@example.invalid" },
            }
          : { kind: "final", text: "Sent after approval." };
      },
    };
    const tool: ToolPort = {
      name: "send_email",
      requiresApproval: true,
      async execute() {
        return { kind: "result", output: "sent" };
      },
    };
    const harness = createHarness({ model, tools: [tool] });
    const paused = await harness.run({ userText: "Send it." });
    expect(paused).toMatchObject({ kind: "paused", approvalId: "call-2" });
    await expect(
      harness.resume({ approvalId: "call-2", decision: "reject" }),
    ).resolves.toEqual({ kind: "rejected" });
  });
});
