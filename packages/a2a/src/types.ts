import { z } from "zod";
import { type Id } from "@town/contracts";

export const a2aStatusSchema = z.enum([
  "pending",
  "accepted",
  "declined",
  "cancelled",
  "completed",
]);
export const a2aConsentStatusSchema = z.enum([
  "pending",
  "granted",
  "denied",
  "revoked",
]);
export type A2AStatus = z.infer<typeof a2aStatusSchema>;
export interface A2ARequest {
  id: Id<"a2a-request">;
  requesterId: Id<"user">;
  recipientId: Id<"user">;
  capability: string;
  request: Record<string, unknown>;
  result: Record<string, unknown> | null;
  status: A2AStatus;
  consentStatus: z.infer<typeof a2aConsentStatusSchema>;
  consentScope: string[];
  consentedBy: Id<"user"> | null;
  consentedAt: Date | null;
  revision: number;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export class A2AError extends Error {
  constructor(
    readonly code:
      "A2A_NOT_FOUND" | "A2A_CONFLICT" | "A2A_FORBIDDEN" | "A2A_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "A2AError";
  }
}
