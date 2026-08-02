import { describe, expect, it } from "vitest";

import { evaluatePolicy, type PolicyInput } from "../src/index.js";

const base: PolicyInput = {
  sessionMode: "allow_all",
  routineMode: "autonomous",
  perToolOverride: null,
  sideEffect: "read",
  dataSensitivity: "public",
  inputTrust: "trusted_instruction",
  targetIsSelf: true,
  targetIsTrusted: true,
  accountBound: false,
};

describe("deterministic policy evaluation", () => {
  it("allows read-only actions and records no fabricated result", () => {
    expect(evaluatePolicy(base)).toEqual({
      decision: "allow",
      riskFlags: [],
      rationale: "Read-only tools do not change state.",
    });
  });

  it("denies every write under read-only mode", () => {
    expect(
      evaluatePolicy({
        ...base,
        routineMode: "read_only",
        sideEffect: "private_write",
      }).decision,
    ).toBe("deny");
  });

  it("allows only safe private self writes in the safe-actions mode", () => {
    expect(
      evaluatePolicy({
        ...base,
        sessionMode: "allow_safe_actions",
        sideEffect: "private_write",
      }).decision,
    ).toBe("allow");
    expect(
      evaluatePolicy({
        ...base,
        sessionMode: "allow_safe_actions",
        sideEffect: "private_write",
        targetIsSelf: false,
        targetIsTrusted: false,
      }).decision,
    ).toBe("approval_required");
  });

  it("requires approval for the private-data, untrusted-input, outbound combination", () => {
    const result = evaluatePolicy({
      ...base,
      sideEffect: "external_write",
      dataSensitivity: "private",
      inputTrust: "untrusted_data",
    });
    expect(result.decision).toBe("approval_required");
    expect(result.riskFlags).toContain(
      "private_data_untrusted_input_external_send",
    );
  });

  it("never autonomously allows destructive actions", () => {
    expect(
      evaluatePolicy({ ...base, sideEffect: "destructive" }).decision,
    ).toBe("approval_required");
  });
});
