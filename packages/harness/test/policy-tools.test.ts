import { describe, expect, it, vi } from "vitest";

import { createHarness } from "../src/index.js";
import { createPolicyAwareHarnessTool } from "../src/policy-tools.js";

const definition = {
  name: "send_message",
  description: "Send a message.",
  parameters: { type: "object", properties: {} },
};

describe("policy-aware Harness tools", () => {
  it("pauses for approval and only executes after an approved resume", async () => {
    const execute = vi.fn(async (_args, context) => ({
      kind: "result" as const,
      output: JSON.stringify({ approved: context?.approvalGranted === true }),
    }));
    const tool = createPolicyAwareHarnessTool({
      definition,
      decide: () => "approval_required",
      execute,
    }).port;
    let calls = 0;
    const harness = createHarness({
      tools: [tool],
      model: {
        async respond() {
          calls += 1;
          return calls === 1
            ? {
                kind: "tool_call" as const,
                callId: "call-1",
                toolName: "send_message",
                arguments: { body: "hello" },
              }
            : { kind: "final" as const, text: "sent" };
        },
      },
    });

    await expect(harness.run({ userText: "send it" })).resolves.toMatchObject({
      kind: "paused",
      approvalId: "call-1",
    });
    expect(execute).not.toHaveBeenCalled();
    await expect(
      harness.resume({ approvalId: "call-1", decision: "approve" }),
    ).resolves.toMatchObject({ kind: "completed", text: "sent" });
    expect(execute).toHaveBeenCalledWith(
      { body: "hello" },
      {
        approvalGranted: true,
        callId: "call-1",
        policyDecision: "approval_required",
      },
    );
  });

  it("fails closed for denied policy decisions", async () => {
    const execute = vi.fn();
    const tool = createPolicyAwareHarnessTool({
      definition,
      decide: () => "deny",
      execute,
    }).port;
    const harness = createHarness({
      tools: [tool],
      model: {
        async respond() {
          return {
            kind: "tool_call" as const,
            callId: "call-2",
            toolName: "send_message",
            arguments: {},
          };
        },
      },
      maxSteps: 1,
    });
    await expect(harness.run({ userText: "send it" })).rejects.toThrow(
      "HARNESS_STEP_LIMIT",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not allow a deny decision to become allow on a second evaluation", async () => {
    const execute = vi.fn();
    const decisions: Array<"deny" | "allow"> = ["deny", "allow"];
    const tool = createPolicyAwareHarnessTool({
      definition,
      decide: () => decisions.shift() ?? "allow",
      execute,
    }).port;
    const harness = createHarness({
      tools: [tool],
      model: {
        async respond() {
          return {
            kind: "tool_call" as const,
            callId: "call-3",
            toolName: "send_message",
            arguments: {},
          };
        },
      },
      maxSteps: 1,
    });
    await expect(harness.run({ userText: "send it" })).rejects.toThrow(
      "HARNESS_STEP_LIMIT",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("never executes a native ToolPort when its dynamic decision is deny", async () => {
    const execute = vi.fn(async () => ({
      kind: "result" as const,
      output: "sent",
    }));
    const harness = createHarness({
      tools: [
        {
          name: "native_deny",
          requiresApproval: () => "deny" as const,
          execute,
        },
      ],
      model: {
        async respond() {
          return {
            kind: "tool_call" as const,
            callId: "call-4",
            toolName: "native_deny",
            arguments: {},
          };
        },
      },
      maxSteps: 1,
    });
    await expect(harness.run({ userText: "send it" })).rejects.toThrow(
      "HARNESS_STEP_LIMIT",
    );
    expect(execute).not.toHaveBeenCalled();
  });
});
