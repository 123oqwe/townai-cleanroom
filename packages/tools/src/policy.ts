import type {
  ExecutionMode,
  PolicyInput,
  PolicyResult,
  ToolSideEffect,
} from "./types.js";

function modeFor(input: PolicyInput): ExecutionMode {
  return input.perToolOverride ?? input.routineMode;
}

function changes(sideEffect: ToolSideEffect): boolean {
  return sideEffect !== "read";
}

export function evaluatePolicy(input: PolicyInput): PolicyResult {
  const riskFlags: string[] = [];
  const selectedMode = modeFor(input);
  const outbound = input.sideEffect === "external_write";
  const destructive = input.sideEffect === "destructive";
  const privateData = input.dataSensitivity !== "public";
  const untrusted = input.inputTrust === "untrusted_data";
  const restrictedData = input.dataSensitivity === "restricted";

  if (input.accountBound && !input.targetIsSelf && !input.targetIsTrusted) {
    riskFlags.push("untrusted_account_target");
  }
  if (privateData && untrusted && outbound) {
    riskFlags.push("private_data_untrusted_input_external_send");
  }
  // Prompt injection risk: restricted data flowing through untrusted input
  // to an outbound action is the most dangerous combination in Town.
  if (restrictedData && untrusted) {
    riskFlags.push("restricted_data_untrusted_input");
  }
  if (restrictedData && outbound) {
    riskFlags.push("restricted_data_external_send");
  }
  // Untrusted input reaching a destructive action without approval
  if (untrusted && destructive) {
    riskFlags.push("untrusted_input_destructive_action");
  }
  if (destructive) riskFlags.push("destructive_action");
  if (outbound) riskFlags.push("external_communication");

  if (!changes(input.sideEffect)) {
    return {
      decision: "allow",
      riskFlags,
      rationale: "Read-only tools do not change state.",
    };
  }
  if (input.routineMode === "read_only" || selectedMode === "read_only") {
    return {
      decision: "deny",
      riskFlags,
      rationale: "The active mode permits read-only actions only.",
    };
  }
  if (
    input.sessionMode === "ask_before_changes" &&
    input.perToolOverride === null
  ) {
    return {
      decision: "approval_required",
      riskFlags,
      rationale: "The Session requires approval before changes.",
    };
  }
  if (
    input.sideEffect === "private_write" &&
    input.sessionMode === "allow_safe_actions" &&
    (input.targetIsSelf || input.targetIsTrusted) &&
    selectedMode === "autonomous"
  ) {
    return {
      decision: "allow",
      riskFlags,
      rationale:
        "A safe private write is allowed for a self or trusted target.",
    };
  }
  if (restrictedData && untrusted) {
    return {
      decision: "approval_required",
      riskFlags,
      rationale:
        "Restricted data combined with untrusted input always requires approval.",
    };
  }
  if (untrusted && destructive) {
    return {
      decision: "approval_required",
      riskFlags,
      rationale:
        "Untrusted input reaching a destructive action requires approval.",
    };
  }
  if (privateData && untrusted && outbound) {
    return {
      decision: "approval_required",
      riskFlags,
      rationale:
        "Private data, untrusted input, and external sending require approval together.",
    };
  }
  if (destructive || outbound || selectedMode === "approval_required") {
    return {
      decision: "approval_required",
      riskFlags,
      rationale:
        "The action has external, destructive, or approval-required risk.",
    };
  }
  if (
    selectedMode === "autonomous" &&
    input.sessionMode === "allow_all" &&
    !destructive
  ) {
    return {
      decision: "allow",
      riskFlags,
      rationale:
        "The active policy permits this non-destructive autonomous action.",
    };
  }
  return {
    decision: "approval_required",
    riskFlags,
    rationale: "The action changes state and needs explicit approval.",
  };
}
