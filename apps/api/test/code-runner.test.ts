import { describe, expect, it, vi } from "vitest";

import {
  createTownCodeRunHarnessBinding,
  runNodeCode,
} from "../src/code-runner.js";

describe("town code runner harness tool", () => {
  it("requires approval and returns bounded runner output", async () => {
    const run = vi.fn().mockResolvedValue({
      output: "2",
      truncated: false,
    });
    const binding = createTownCodeRunHarnessBinding(run);

    expect(binding.definition.name).toBe("town_code_run");
    if (typeof binding.port.requiresApproval !== "function")
      throw new Error("approval policy unavailable");
    expect(binding.port.requiresApproval({ code: "1 + 1" })).toBe(
      "approval_required",
    );
    await expect(binding.port.execute({ code: "1 + 1" })).rejects.toThrow(
      "HARNESS_TOOL_APPROVAL_REQUIRED",
    );
    await expect(
      binding.port.execute(
        { code: "1 + 1", timeoutMs: 2_000, maxOutputChars: 1_000 },
        { approvalGranted: true },
      ),
    ).resolves.toMatchObject({
      kind: "result",
      output: JSON.stringify({ output: "2", truncated: false }),
    });
    expect(run).toHaveBeenCalledWith("1 + 1", {
      timeoutMs: 2_000,
      maxOutputChars: 1_000,
    });
  });

  it("denies malformed arguments before invoking the runner", async () => {
    const run = vi.fn();
    const binding = createTownCodeRunHarnessBinding(run);

    await expect(
      binding.port.execute(
        { code: "", timeoutMs: 0 },
        { approvalGranted: true },
      ),
    ).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it("executes a simple expression in the permission-restricted child process", async () => {
    await expect(
      runNodeCode("console.log(2 + 2)", {
        timeoutMs: 2_000,
        maxOutputChars: 1_000,
      }),
    ).resolves.toEqual({ output: "4", truncated: false });
  });

  it("does not grant the child process filesystem permission", async () => {
    await expect(
      runNodeCode("require('fs').readFileSync('/etc/passwd')", {
        timeoutMs: 2_000,
        maxOutputChars: 1_000,
      }),
    ).rejects.toThrow("CODE_RUN_FAILED");
  });
});
