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

export const toolCallStatusSchema = z.enum([
  "proposed",
  "allowed",
  "waiting_approval",
  "denied",
  "approved",
  "executing",
  "succeeded",
  "failed",
  "cancelled",
]);
export const approvalStateSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "expired",
  "cancelled",
]);

export type ToolCallStatus = z.infer<typeof toolCallStatusSchema>;
export type ApprovalState = z.infer<typeof approvalStateSchema>;

export interface ToolCall {
  id: Id<"tool-call">;
  ownerId: Id<"user">;
  sessionId: Id<"runtime-session">;
  runId: Id<"session-run">;
  agentVersionId: Id<"agent-version">;
  toolDefinitionId: Id<"tool-definition">;
  policyDecisionId: Id<"policy-decision">;
  stepKey: string;
  argumentHash: string;
  arguments: Record<string, unknown>;
  status: ToolCallStatus;
  approvalRequestId: Id<"approval-request"> | null;
  result: Record<string, unknown> | null;
  errorCode: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

export interface ApprovalRequest {
  id: Id<"approval-request">;
  ownerId: Id<"user">;
  sessionId: Id<"runtime-session">;
  runId: Id<"session-run">;
  toolCallId: Id<"tool-call">;
  argumentHash: string;
  arguments: Record<string, unknown>;
  state: ApprovalState;
  revision: number;
  expiresAt: Date | null;
  decidedAt: Date | null;
  decidedBy: Id<"user"> | null;
  decisionNote: string | null;
}
