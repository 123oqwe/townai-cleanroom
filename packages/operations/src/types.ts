import { z } from "zod";

import { type Id } from "@town/contracts";

export const auditOutcomeSchema = z.enum(["succeeded", "failed"]);
export type AuditOutcome = z.infer<typeof auditOutcomeSchema>;

export interface AuditEvent {
  id: Id<"operation-audit-event">;
  ownerId: Id<"user">;
  actorId: Id<"user"> | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: AuditOutcome;
  requestId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}
export interface AuditPage {
  items: AuditEvent[];
  nextCursor: string | null;
}
export interface TimelineItem {
  kind: "delivery" | "audit";
  id: string;
  createdAt: Date;
  data: Record<string, unknown>;
}
export interface TimelinePage {
  items: TimelineItem[];
  nextCursor: string | null;
}
export interface AnalyticsEvent {
  id: Id<"operation-analytics-event">;
  ownerId: Id<"user">;
  eventName: string;
  metadata: Record<string, unknown>;
  dedupeKey: string | null;
  createdAt: Date;
}
export interface AnalyticsPage {
  items: AnalyticsEvent[];
  nextCursor: string | null;
}
export interface PublicAnalyticsReceipt {
  accepted: true;
  replayed: boolean;
}
export const presenceSurfaceSchema = z.enum([
  "web",
  "ios",
  "macos",
  "email",
  "slack",
  "whatsapp",
  "telegram",
  "imessage",
]);
export type PresenceSurface = z.infer<typeof presenceSurfaceSchema>;
export interface PresenceSession {
  id: Id<"presence-session">;
  ownerId: Id<"user">;
  sessionId: string;
  surface: PresenceSurface;
  clientSha: string | null;
  deploymentTime: Date | null;
  userAgent: string | null;
  lastSeenAt: Date;
  expiresAt: Date;
  createdAt: Date;
}
export interface OperationSummary {
  activeSessions: number;
  queuedRuns: number;
  failedRuns: number;
  pendingApprovals: number;
  queuedDeliveries: number;
  failedDeliveries: number;
}
export class OperationsError extends Error {
  constructor(
    readonly code:
      "AUDIT_CONFLICT" | "INVALID_CURSOR" | "INVALID_METADATA" | "RATE_LIMITED",
    message: string,
  ) {
    super(message);
    this.name = "OperationsError";
  }
}
