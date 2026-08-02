import { z } from "zod";

import type { Id } from "@town/contracts";

export const toolSideEffectSchema = z.enum([
  "read",
  "private_write",
  "external_write",
  "destructive",
]);
export const dataSensitivitySchema = z.enum([
  "public",
  "private",
  "restricted",
]);
export const accountBindingSchema = z.enum(["required", "optional", "none"]);
export const executionModeSchema = z.enum([
  "read_only",
  "approval_required",
  "autonomous",
]);
export const sessionModeSchema = z.enum([
  "ask_before_changes",
  "allow_safe_actions",
  "allow_all",
]);
export const inputTrustSchema = z.enum([
  "trusted_instruction",
  "trusted_data",
  "untrusted_data",
]);
export const policyDecisionSchema = z.enum([
  "allow",
  "approval_required",
  "deny",
]);

export type ToolSideEffect = z.infer<typeof toolSideEffectSchema>;
export type DataSensitivity = z.infer<typeof dataSensitivitySchema>;
export type AccountBinding = z.infer<typeof accountBindingSchema>;
export type ExecutionMode = z.infer<typeof executionModeSchema>;
export type SessionMode = z.infer<typeof sessionModeSchema>;
export type InputTrust = z.infer<typeof inputTrustSchema>;
export type PolicyDecision = z.infer<typeof policyDecisionSchema>;

export const toolDefinitionInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(10_000),
    inputSchema: z.record(z.string(), z.json()),
    outputSchema: z.record(z.string(), z.json()).nullable(),
    sideEffect: toolSideEffectSchema,
    dataSensitivity: dataSensitivitySchema,
    accountBinding: accountBindingSchema,
  })
  .strict();

export type ToolDefinitionInput = z.infer<typeof toolDefinitionInputSchema>;

export interface PolicyInput {
  sessionMode: SessionMode;
  routineMode: ExecutionMode;
  perToolOverride: ExecutionMode | null;
  sideEffect: ToolSideEffect;
  dataSensitivity: DataSensitivity;
  inputTrust: InputTrust;
  targetIsSelf: boolean;
  targetIsTrusted: boolean;
  accountBound: boolean;
}

export interface PolicyResult {
  decision: PolicyDecision;
  riskFlags: string[];
  rationale: string;
}

export interface ToolDefinition {
  id: Id<"tool-definition">;
  ownerId: Id<"user">;
  name: string;
  version: number;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown> | null;
  sideEffect: ToolSideEffect;
  dataSensitivity: DataSensitivity;
  accountBinding: AccountBinding;
  enabled: boolean;
  createdAt: Date;
}

export interface AgentToolBinding {
  id: Id<"agent-tool-binding">;
  ownerId: Id<"user">;
  agentVersionId: Id<"agent-version">;
  toolDefinitionId: Id<"tool-definition">;
  modeOverride: ExecutionMode | null;
  accountScope: string[];
  createdAt: Date;
}
