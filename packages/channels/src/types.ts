import { z } from "zod";

import { type Id } from "@town/contracts";

export const channelKindSchema = z.enum([
  "email",
  "webhook",
  "telegram",
  "whatsapp",
  "slack",
  "imessage",
]);
export const channelStatusSchema = z.enum(["active", "disabled"]);
export const deliveryStatusSchema = z.enum([
  "queued",
  "attempting",
  "succeeded",
  "failed",
]);

export type ChannelKind = z.infer<typeof channelKindSchema>;
export type ChannelStatus = z.infer<typeof channelStatusSchema>;
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

/** Prevents a permanently invalid provider credential from retrying forever. */
export const MAX_DELIVERY_ATTEMPTS = 10;

export interface NotificationChannel {
  id: Id<"notification-channel">;
  ownerId: Id<"user">;
  kind: ChannelKind;
  address: string;
  config: Record<string, unknown>;
  status: ChannelStatus;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationDelivery {
  id: Id<"notification-delivery">;
  ownerId: Id<"user">;
  channelId: Id<"notification-channel">;
  eventType: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  replayOfDeliveryId: Id<"notification-delivery"> | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface ClaimedNotificationDelivery extends NotificationDelivery {
  claimToken: string;
  leaseExpiresAt: Date;
}

export class ChannelError extends Error {
  constructor(
    readonly code:
      | "CHANNEL_NOT_FOUND"
      | "DELIVERY_NOT_FOUND"
      | "CHANNEL_DISABLED"
      | "DELIVERY_CONFLICT"
      | "DELIVERY_NOT_REPLAYABLE"
      | "FORBIDDEN"
      | "INVALID_CHANNEL_CONFIG"
      | "CHANNEL_CREDENTIAL_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "ChannelError";
  }
}

export type ChannelRow = {
  id: string;
  owner_id: string;
  kind: ChannelKind;
  address: string;
  config: Record<string, unknown>;
  status: ChannelStatus;
  verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
};
export type DeliveryRow = {
  id: string;
  owner_id: string;
  channel_id: string;
  event_type: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
  status: DeliveryStatus;
  attempts: number;
  next_attempt_at: Date | null;
  last_error: string | null;
  replay_of_delivery_id: string | null;
  claimed_by: string | null;
  claim_token: string | null;
  claimed_at: Date | null;
  lease_expires_at: Date | null;
  fingerprint: string;
  sent_at: Date | null;
  created_at: Date;
  updated_at: Date;
};
