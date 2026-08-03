import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";

import { asId, idSchema, newId, type Id } from "@town/contracts";

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
      | "FORBIDDEN"
      | "INVALID_CHANNEL_CONFIG"
      | "CHANNEL_CREDENTIAL_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "ChannelError";
  }
}

type ChannelRow = {
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
type DeliveryRow = {
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
  claimed_by: string | null;
  claim_token: string | null;
  claimed_at: Date | null;
  lease_expires_at: Date | null;
  fingerprint: string;
  sent_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

const emailConfig = z
  .object({
    displayName: z.string().trim().max(200).optional(),
    accountId: idSchema.optional(),
  })
  .strict();
const webhookConfig = z
  .object({
    headers: z
      .record(z.string().regex(/^[A-Za-z0-9-]+$/), z.string().max(500))
      .default({}),
  })
  .strict()
  .superRefine((value, context) => {
    if (Object.keys(value.headers).length > 0)
      context.addIssue({
        code: "custom",
        message: "Webhook headers must use a credential reference.",
      });
  });
const chatConfig = z
  .object({
    chatId: z.string().trim().min(1).max(300).optional(),
    credentialRef: z.string().trim().min(1).max(200).optional(),
    phoneNumberId: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
const createInput = z
  .object({
    ownerId: idSchema,
    kind: channelKindSchema,
    address: z.string().trim().min(1).max(2_000),
    config: z.record(z.string(), z.json()).default({}),
  })
  .strict();
const enqueueInput = z
  .object({
    ownerId: idSchema,
    channelId: idSchema,
    eventType: z.string().trim().min(1).max(200),
    idempotencyKey: z.string().trim().min(1).max(500),
    payload: z.record(z.string(), z.json()),
  })
  .strict();

function isRetryableDeliveryError(error: string): boolean {
  if (
    [
      "CHANNEL_CREDENTIAL_EMPTY",
      "CHANNEL_CREDENTIAL_UNAVAILABLE",
      "CHANNEL_EMAIL_TRANSPORT_UNAVAILABLE",
      "CHANNEL_EMAIL_ACCOUNT_NOT_CONFIGURED",
      "CHANNEL_PHONE_NUMBER_ID_UNAVAILABLE",
    ].some((code) => error.includes(code))
  )
    return false;
  const status = /^CHANNEL_HTTP_(\d{3})$/.exec(error)?.[1];
  if (status === undefined) return true;
  const code = Number(status);
  return code === 408 || code === 425 || code === 429 || code >= 500;
}

function safeChannel(row: ChannelRow): NotificationChannel {
  const config = Object.fromEntries(
    Object.entries(row.config).filter(
      ([key]) => !/(token|secret|password|credential|private.?key)/i.test(key),
    ),
  );
  return {
    id: asId<"notification-channel">(row.id),
    ownerId: asId<"user">(row.owner_id),
    kind: row.kind,
    address: row.address,
    config,
    status: row.status,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function validateChannelConfig(
  kind: ChannelKind,
  config: Record<string, unknown>,
) {
  const parsed =
    kind === "email"
      ? emailConfig.safeParse(config)
      : kind === "webhook"
        ? webhookConfig.safeParse(config)
        : chatConfig.safeParse(config);
  if (!parsed.success)
    throw new ChannelError(
      "INVALID_CHANNEL_CONFIG",
      "Channel configuration must use public metadata or a credential reference.",
    );
  return parsed.data as Record<string, unknown>;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}
function fingerprint(value: {
  channelId: string;
  eventType: string;
  payload: Record<string, unknown>;
}): string {
  return JSON.stringify(canonical(value));
}
function safeDelivery(row: DeliveryRow): NotificationDelivery {
  return {
    id: asId<"notification-delivery">(row.id),
    ownerId: asId<"user">(row.owner_id),
    channelId: asId<"notification-channel">(row.channel_id),
    eventType: row.event_type,
    idempotencyKey: row.idempotency_key,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function safeClaimed(row: DeliveryRow): ClaimedNotificationDelivery {
  if (!row.claim_token || !row.lease_expires_at)
    throw new ChannelError(
      "DELIVERY_CONFLICT",
      "The delivery claim is incomplete.",
    );
  return {
    ...safeDelivery(row),
    claimToken: row.claim_token,
    leaseExpiresAt: row.lease_expires_at,
  };
}

export function createChannelRepository(sql: Sql) {
  async function getChannel(
    tx: Sql | TransactionSql,
    ownerId: Id<"user">,
    channelId: Id<"notification-channel">,
  ) {
    const [row] = await tx<
      ChannelRow[]
    >`select * from notification_channels where owner_id=${idSchema.parse(ownerId)} and id=${idSchema.parse(channelId)} for update`;
    if (!row)
      throw new ChannelError(
        "CHANNEL_NOT_FOUND",
        "The notification channel was not found.",
      );
    return row;
  }
  async function create(
    input: z.input<typeof createInput>,
  ): Promise<NotificationChannel> {
    const value = createInput.parse(input);
    const config = validateChannelConfig(value.kind, value.config);
    if (value.kind === "webhook") {
      const url = z.url().parse(value.address);
      if (
        new URL(url).search ||
        new URL(url).hash ||
        new URL(url).username ||
        new URL(url).password
      )
        throw new ChannelError(
          "INVALID_CHANNEL_CONFIG",
          "Webhook addresses cannot contain embedded secrets.",
        );
    }
    const [row] = await sql<
      ChannelRow[]
    >`insert into notification_channels (id,owner_id,kind,address,config) values (${newId<"notification-channel">()},${value.ownerId},${value.kind},${value.address},${sql.json(config as never)}) returning *`;
    if (!row)
      throw new ChannelError(
        "CHANNEL_NOT_FOUND",
        "The notification channel could not be created.",
      );
    return safeChannel(row);
  }
  async function list(ownerId: Id<"user">): Promise<NotificationChannel[]> {
    const rows = await sql<
      ChannelRow[]
    >`select * from notification_channels where owner_id=${idSchema.parse(ownerId)} order by created_at desc,id desc`;
    return rows.map(safeChannel);
  }
  async function disable(
    ownerId: Id<"user">,
    channelId: Id<"notification-channel">,
  ): Promise<NotificationChannel> {
    const [row] = await sql<
      ChannelRow[]
    >`update notification_channels set status='disabled',updated_at=now() where owner_id=${idSchema.parse(ownerId)} and id=${idSchema.parse(channelId)} returning *`;
    if (!row)
      throw new ChannelError(
        "CHANNEL_NOT_FOUND",
        "The notification channel was not found.",
      );
    return safeChannel(row);
  }
  async function enqueue(
    input: z.input<typeof enqueueInput>,
  ): Promise<NotificationDelivery> {
    const value = enqueueInput.parse(input);
    const requestFingerprint = fingerprint({
      channelId: value.channelId,
      eventType: value.eventType,
      payload: value.payload,
    });
    const row = await sql.begin(async (tx) => {
      const [existing] = await tx<
        DeliveryRow[]
      >`select * from notification_deliveries where owner_id=${value.ownerId} and idempotency_key=${value.idempotencyKey} for update`;
      if (existing) {
        if (existing.fingerprint !== requestFingerprint)
          throw new ChannelError(
            "DELIVERY_CONFLICT",
            "The idempotency key is already bound to a different delivery.",
          );
        return existing;
      }
      const channel = await getChannel(
        tx,
        value.ownerId as Id<"user">,
        value.channelId as Id<"notification-channel">,
      );
      if (channel.status !== "active")
        throw new ChannelError(
          "CHANNEL_DISABLED",
          "The notification channel is disabled.",
        );
      const [delivery] = await tx<
        DeliveryRow[]
      >`insert into notification_deliveries (id,owner_id,channel_id,event_type,idempotency_key,payload,fingerprint) values (${newId<"notification-delivery">()},${value.ownerId},${value.channelId},${value.eventType},${value.idempotencyKey},${tx.json(value.payload)},${requestFingerprint}) on conflict (owner_id,idempotency_key) do nothing returning *`;
      if (!delivery) {
        const [raced] = await tx<
          DeliveryRow[]
        >`select * from notification_deliveries where owner_id=${value.ownerId} and idempotency_key=${value.idempotencyKey} for update`;
        if (!raced || raced.fingerprint !== requestFingerprint)
          throw new ChannelError(
            "DELIVERY_CONFLICT",
            "The idempotency key is already bound to a different delivery.",
          );
        return raced;
      }
      return delivery;
    });
    return safeDelivery(row);
  }
  async function claimNext(
    workerId: string,
    leaseMs = 60_000,
  ): Promise<ClaimedNotificationDelivery | null> {
    const worker = z.string().trim().min(1).max(200).parse(workerId);
    const lease = z.number().int().min(1_000).max(86_400_000).parse(leaseMs);
    const [row] = await sql.begin(async (tx) => {
      const [candidate] = await tx<
        DeliveryRow[]
      >`select d.* from notification_deliveries d join notification_channels c on c.owner_id=d.owner_id and c.id=d.channel_id and c.status='active' where d.attempts < ${MAX_DELIVERY_ATTEMPTS} and (d.status='queued' or (d.status='failed' and d.next_attempt_at is not null and d.next_attempt_at <= now()) or (d.status='attempting' and d.lease_expires_at is not null and d.lease_expires_at <= now())) order by d.created_at,d.id for update of d,c skip locked limit 1`;
      if (!candidate) return [];
      return tx<
        DeliveryRow[]
      >`update notification_deliveries set status='attempting',attempts=attempts+1,claimed_by=${worker},claim_token=${newId<"notification-claim">()},claimed_at=now(),lease_expires_at=now()+(${lease} * interval '1 millisecond'),last_error=null where id=${candidate.id} returning *`;
    });
    return row ? safeClaimed(row) : null;
  }
  async function complete(input: {
    ownerId: Id<"user">;
    deliveryId: Id<"notification-delivery">;
    workerId: string;
    claimToken: string;
    success: boolean;
    error?: string;
    retryAt?: Date | null;
  }): Promise<NotificationDelivery> {
    const ownerId = idSchema.parse(input.ownerId);
    const deliveryId = idSchema.parse(input.deliveryId);
    const workerId = z.string().trim().min(1).max(200).parse(input.workerId);
    const claimToken = idSchema.parse(input.claimToken);
    const [row] = await sql.begin(
      async (tx) =>
        tx<
          DeliveryRow[]
        >`update notification_deliveries set status=${input.success ? "succeeded" : "failed"},claimed_by=null,claim_token=null,claimed_at=null,lease_expires_at=null,last_error=${input.success ? null : (input.error ?? "delivery_failed")},next_attempt_at=${input.success ? null : (input.retryAt ?? null)},sent_at=${input.success ? sql`now()` : null},updated_at=now() where owner_id=${ownerId} and id=${deliveryId} and status='attempting' and claimed_by=${workerId} and claim_token=${claimToken} and lease_expires_at > now() returning *`,
    );
    if (!row)
      throw new ChannelError(
        "DELIVERY_CONFLICT",
        "The delivery claim is no longer valid.",
      );
    return safeDelivery(row);
  }
  async function deliverNext(input: {
    workerId: string;
    leaseMs?: number;
    fetch?: typeof globalThis.fetch;
    sendEmail?: (value: {
      ownerId: Id<"user">;
      accountId: Id<"connected-account">;
      to: string;
      subject: string;
      body: string;
    }) => Promise<void>;
    resolveCredential?: (value: {
      ownerId: Id<"user">;
      credentialRef: string;
    }) => Promise<string>;
  }): Promise<{ delivery: NotificationDelivery | null; claimed: boolean }> {
    const claimed = await claimNext(input.workerId, input.leaseMs);
    if (claimed === null) return { delivery: null, claimed: false };
    const request = input.fetch ?? globalThis.fetch;
    let success = false;
    let error: string | undefined;
    try {
      if (request === undefined) throw new Error("CHANNEL_FETCH_UNAVAILABLE");
      const [channel] = await sql<
        Pick<ChannelRow, "kind" | "address" | "config">[]
      >`
        select kind, address, config from notification_channels
        where owner_id=${claimed.ownerId} and id=${claimed.channelId} and status='active'
      `;
      if (channel === undefined) throw new Error("CHANNEL_NOT_FOUND");
      if (channel.kind === "email") {
        if (input.sendEmail === undefined)
          throw new Error("CHANNEL_EMAIL_TRANSPORT_UNAVAILABLE");
        const accountId = idSchema.safeParse(channel.config["accountId"]);
        if (!accountId.success)
          throw new Error("CHANNEL_EMAIL_ACCOUNT_NOT_CONFIGURED");
        const subject =
          typeof claimed.payload["subject"] === "string"
            ? claimed.payload["subject"]
            : claimed.eventType;
        const body =
          typeof claimed.payload["body"] === "string"
            ? claimed.payload["body"]
            : JSON.stringify(claimed.payload, null, 2);
        await input.sendEmail({
          ownerId: claimed.ownerId,
          accountId: asId<"connected-account">(accountId.data),
          to: channel.address,
          subject,
          body,
        });
      } else if (channel.kind === "webhook") {
        const response = await request(channel.address, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            eventType: claimed.eventType,
            payload: claimed.payload,
          }),
        });
        if (!response.ok) throw new Error(`CHANNEL_HTTP_${response.status}`);
      } else if (
        channel.kind === "telegram" ||
        channel.kind === "whatsapp" ||
        channel.kind === "slack"
      ) {
        if (input.resolveCredential === undefined)
          throw new Error("CHANNEL_CREDENTIAL_UNAVAILABLE");
        const config = chatConfig.parse(channel.config);
        if (config.credentialRef === undefined)
          throw new Error("CHANNEL_CREDENTIAL_UNAVAILABLE");
        const credential = z
          .string()
          .trim()
          .min(1, "CHANNEL_CREDENTIAL_EMPTY")
          .parse(
            await input.resolveCredential({
              ownerId: claimed.ownerId,
              credentialRef: config.credentialRef,
            }),
          );
        const text =
          typeof claimed.payload["body"] === "string"
            ? claimed.payload["body"]
            : JSON.stringify(claimed.payload, null, 2);
        let url: string;
        let body: Record<string, unknown>;
        const headers: Record<string, string> = {
          accept: "application/json",
          "content-type": "application/json",
        };
        if (channel.kind === "telegram") {
          url = `https://api.telegram.org/bot${encodeURIComponent(credential)}/sendMessage`;
          body = { chat_id: channel.address, text };
        } else if (channel.kind === "whatsapp") {
          if (config.phoneNumberId === undefined)
            throw new Error("CHANNEL_PHONE_NUMBER_ID_UNAVAILABLE");
          url = `https://graph.facebook.com/v20.0/${encodeURIComponent(config.phoneNumberId)}/messages`;
          headers["authorization"] = `Bearer ${credential}`;
          body = {
            messaging_product: "whatsapp",
            to: channel.address,
            type: "text",
            text: { body: text },
          };
        } else {
          url = credential;
          body = { text };
        }
        const response = await request(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`CHANNEL_HTTP_${response.status}`);
      } else {
        throw new Error(`CHANNEL_KIND_UNSUPPORTED:${channel.kind}`);
      }
      success = true;
    } catch (caught) {
      error =
        caught instanceof Error ? caught.message : "CHANNEL_DELIVERY_FAILED";
    }
    const retryAt =
      success ||
      claimed.attempts >= MAX_DELIVERY_ATTEMPTS ||
      (error !== undefined && !isRetryableDeliveryError(error))
        ? null
        : new Date(
            Date.now() +
              Math.min(300_000, 1_000 * 2 ** Math.min(claimed.attempts, 8)),
          );
    const delivery = await complete({
      ownerId: claimed.ownerId,
      deliveryId: claimed.id,
      workerId: input.workerId,
      claimToken: claimed.claimToken,
      success,
      ...(error === undefined ? {} : { error }),
      ...(retryAt === null ? {} : { retryAt }),
    });
    return { delivery, claimed: true };
  }
  return { create, list, disable, enqueue, claimNext, complete, deliverNext };
}
export type ChannelRepository = ReturnType<typeof createChannelRepository>;
