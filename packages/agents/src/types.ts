import { z } from "zod";

import type { Id } from "@town/contracts";

export const approvalModeSchema = z.enum([
  "respect_tool_setting",
  "require_approval",
  "autonomous",
]);

export const agentVersionSnapshotSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100),
    instructions: z.string().max(50_000),
    defaultApprovalMode: approvalModeSchema,
  })
  .strict();

export type ApprovalMode = z.infer<typeof approvalModeSchema>;
export type AgentVersionSnapshot = z.infer<typeof agentVersionSnapshotSchema>;

export interface AgentVersion {
  id: Id<"agent-version">;
  agentId: Id<"agent">;
  version: number;
  snapshot: AgentVersionSnapshot;
  changeReason: string | null;
  createdBy: "user" | "system";
  createdAt: Date;
}

export interface PersonalAgent {
  id: Id<"agent">;
  ownerId: Id<"user">;
  kind: "personal";
  status: "active" | "disabled";
  revision: number;
  activeVersion: AgentVersion;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentVersionPage {
  items: AgentVersion[];
  nextCursor: string | null;
}
