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

export const threadKindSchema = z.enum(["assistant", "task"]);
export const threadStatusSchema = z.enum(["active", "archived"]);

export type ThreadKind = z.infer<typeof threadKindSchema>;
export type ThreadStatus = z.infer<typeof threadStatusSchema>;

export interface ConversationThread {
  id: Id<"thread">;
  ownerId: Id<"user">;
  agentId: Id<"agent">;
  kind: ThreadKind;
  title: string;
  approvalMode: ApprovalMode;
  status: ThreadStatus;
  pinnedAt: Date | null;
  revision: number;
  lastTurnSequence: number;
  readThroughSequence: number;
  unread: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ThreadPage {
  items: ConversationThread[];
  nextCursor: string | null;
}

export const mentionTargetTypeSchema = z.enum([
  "agent",
  "thread",
  "task",
  "routine",
  "content",
]);
export const turnRoleSchema = z.enum(["user", "assistant", "system"]);
export const turnSourceTypeSchema = z.enum(["user", "runtime", "channel"]);

export interface ThreadMention {
  id: Id<"thread-mention">;
  position: number;
  targetType: z.infer<typeof mentionTargetTypeSchema>;
  targetId: Id<"mention-target">;
  label: string;
  createdAt: Date;
}

export interface ThreadTurn {
  id: Id<"thread-turn">;
  ownerId: Id<"user">;
  threadId: Id<"thread">;
  sequence: number;
  role: z.infer<typeof turnRoleSchema>;
  text: string;
  sourceType: z.infer<typeof turnSourceTypeSchema>;
  sourceRef: string | null;
  mentions: ThreadMention[];
  createdAt: Date;
}

export interface TurnPage {
  items: ThreadTurn[];
  nextCursor: string | null;
}
