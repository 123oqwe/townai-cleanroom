import type { HarnessToolBinding } from "./agent-factory.js";
import type { ResponsesToolDefinition } from "./responses.js";
import type { ToolPort } from "./index.js";

export type HarnessPolicyDecision = "allow" | "approval_required" | "deny";

/**
 * Adapts a deterministic policy decision to Harness' pause/resume contract.
 * Approval is never inferred from a tool result: resume must provide an
 * explicit approvalGranted context.
 */
export function createPolicyAwareHarnessTool(input: {
  definition: ResponsesToolDefinition;
  decide: (arguments_: Record<string, unknown>) => HarnessPolicyDecision;
  execute: ToolPort["execute"];
}): HarnessToolBinding {
  const port: ToolPort = {
    name: input.definition.name,
    requiresApproval: (arguments_) => input.decide(arguments_),
    async execute(arguments_, context = { approvalGranted: false }) {
      const currentDecision = input.decide(arguments_);
      const decision =
        context.policyDecision === "deny" || currentDecision === "deny"
          ? "deny"
          : context.policyDecision === "approval_required"
            ? "approval_required"
            : currentDecision;
      if (decision === "deny")
        throw new Error(
          "HARNESS_TOOL_POLICY_DENIED: policy denied this action.",
        );
      if (decision === "approval_required" && !context.approvalGranted)
        throw new Error(
          "HARNESS_TOOL_APPROVAL_REQUIRED: approval is required before execution.",
        );
      return input.execute(arguments_, context);
    },
  };
  return { definition: input.definition, port };
}
