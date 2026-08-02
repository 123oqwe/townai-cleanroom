import type { Sql } from "postgres";
import { z } from "zod";

import { asId, idSchema, newId, type Id } from "@town/contracts";

export const creditBandSchema = z.enum(["healthy", "warning", "blocked"]);
export const usageCategorySchema = z.enum([
  "model",
  "tool",
  "search",
  "routine",
  "storage",
]);
export type CreditBand = z.infer<typeof creditBandSchema>;
export type UsageCategory = z.infer<typeof usageCategorySchema>;

export interface BillingState {
  ownerId: Id<"user">;
  planName: string;
  isBlocked: boolean;
  isTrial: boolean;
  isEnterprise: boolean;
  creditBand: CreditBand;
  creditBanners: string[];
  periodStart: Date | null;
  periodEnd: Date | null;
  revision: number;
  updatedAt: Date;
}
export interface UsageEntry {
  id: Id<"usage-entry">;
  ownerId: Id<"user">;
  idempotencyKey: string;
  category: UsageCategory;
  quantity: string;
  unit: string;
  metadata: Record<string, unknown>;
  occurredAt: Date;
}
export interface UsageSummary {
  category: UsageCategory;
  quantity: string;
  unit: string;
}
export class BillingError extends Error {
  constructor(
    readonly code:
      | "BILLING_NOT_CONFIGURED"
      | "USAGE_CONFLICT"
      | "INVALID_USAGE"
      | "BILLING_REVISION_CONFLICT"
      | "INVALID_PERIOD",
    message: string,
  ) {
    super(message);
    this.name = "BillingError";
  }
}
type StateRow = {
  owner_id: string;
  plan_name: string;
  is_blocked: boolean;
  is_trial: boolean;
  is_enterprise: boolean;
  credit_band: CreditBand;
  credit_banners: string[];
  period_start: Date | null;
  period_end: Date | null;
  revision: number;
  updated_at: Date;
};
type UsageRow = {
  id: string;
  owner_id: string;
  idempotency_key: string;
  fingerprint: string;
  category: UsageCategory;
  quantity: bigint;
  unit: string;
  metadata: Record<string, unknown>;
  occurred_at: Date;
};
const stateInput = z
  .object({
    ownerId: idSchema,
    planName: z.string().trim().min(1).max(100),
    isBlocked: z.boolean().default(false),
    isTrial: z.boolean().default(false),
    isEnterprise: z.boolean().default(false),
    creditBand: creditBandSchema.default("healthy"),
    creditBanners: z
      .array(z.string().trim().min(1).max(500))
      .max(20)
      .default([]),
    periodStart: z.date().nullable().optional(),
    periodEnd: z.date().nullable().optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const startMissing =
      value.periodStart === undefined || value.periodStart === null;
    const endMissing =
      value.periodEnd === undefined || value.periodEnd === null;
    if (startMissing !== endMissing)
      context.addIssue({
        code: "custom",
        message: "Billing periods require both endpoints or neither.",
      });
    if (
      value.periodStart &&
      value.periodEnd &&
      value.periodEnd <= value.periodStart
    )
      context.addIssue({
        code: "custom",
        message: "Billing period end must be after start.",
      });
  });
const usageInput = z
  .object({
    ownerId: idSchema,
    idempotencyKey: z.string().trim().min(1).max(500),
    category: usageCategorySchema,
    quantity: z.union([
      z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      z.string().regex(/^[1-9][0-9]*$/),
    ]),
    unit: z.string().trim().min(1).max(50),
    metadata: z.record(z.string(), z.json()).default({}),
    occurredAt: z.date().optional(),
  })
  .strict();
function safeState(row: StateRow): BillingState {
  return {
    ownerId: asId<"user">(row.owner_id),
    planName: row.plan_name,
    isBlocked: row.is_blocked,
    isTrial: row.is_trial,
    isEnterprise: row.is_enterprise,
    creditBand: row.credit_band,
    creditBanners: row.credit_banners,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}
function safeUsage(row: UsageRow): UsageEntry {
  return {
    id: asId<"usage-entry">(row.id),
    ownerId: asId<"user">(row.owner_id),
    idempotencyKey: row.idempotency_key,
    category: row.category,
    quantity: row.quantity.toString(),
    unit: row.unit,
    metadata: row.metadata,
    occurredAt: row.occurred_at,
  };
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}
function usageFingerprint(value: {
  category: UsageCategory;
  quantity: bigint;
  unit: string;
  metadata: Record<string, unknown>;
  occurredAt: Date | null;
}): string {
  return JSON.stringify(
    canonical({
      category: value.category,
      quantity: value.quantity.toString(),
      unit: value.unit,
      metadata: value.metadata,
      occurredAt: value.occurredAt?.toISOString() ?? null,
    }),
  );
}
export function createBillingRepository(sql: Sql) {
  async function get(ownerId: Id<"user">): Promise<BillingState | null> {
    const [row] = await sql<
      StateRow[]
    >`select owner_id,plan_name,is_blocked,is_trial,is_enterprise,credit_band,credit_banners,period_start,period_end,revision,updated_at from billing_accounts where owner_id=${idSchema.parse(ownerId)}`;
    return row ? safeState(row) : null;
  }
  async function setState(
    input: z.input<typeof stateInput>,
  ): Promise<BillingState> {
    const value = stateInput.parse(input);
    const [row] = await sql.begin(async (tx) => {
      const [current] = await tx<
        { revision: number }[]
      >`select revision from billing_accounts where owner_id=${value.ownerId} for update`;
      if (!current) {
        if (
          value.expectedRevision !== undefined &&
          value.expectedRevision !== 0
        )
          throw new BillingError(
            "BILLING_REVISION_CONFLICT",
            "A new billing state must start at revision 0.",
          );
        const [created] = await tx<
          StateRow[]
        >`insert into billing_accounts (owner_id,plan_name,is_blocked,is_trial,is_enterprise,credit_band,credit_banners,period_start,period_end) values (${value.ownerId},${value.planName},${value.isBlocked},${value.isTrial},${value.isEnterprise},${value.creditBand},${sql.json(value.creditBanners)},${value.periodStart ?? null},${value.periodEnd ?? null}) on conflict (owner_id) do nothing returning owner_id,plan_name,is_blocked,is_trial,is_enterprise,credit_band,credit_banners,period_start,period_end,revision,updated_at`;
        if (!created)
          throw new BillingError(
            "BILLING_REVISION_CONFLICT",
            "The billing state changed concurrently.",
          );
        return [created];
      }
      if (
        value.expectedRevision === undefined ||
        value.expectedRevision !== current.revision
      )
        throw new BillingError(
          "BILLING_REVISION_CONFLICT",
          "The billing state changed concurrently.",
        );
      return tx<
        StateRow[]
      >`update billing_accounts set plan_name=${value.planName},is_blocked=${value.isBlocked},is_trial=${value.isTrial},is_enterprise=${value.isEnterprise},credit_band=${value.creditBand},credit_banners=${sql.json(value.creditBanners)},period_start=${value.periodStart ?? null},period_end=${value.periodEnd ?? null},revision=revision+1,updated_at=now() where owner_id=${value.ownerId} and revision=${value.expectedRevision} returning owner_id,plan_name,is_blocked,is_trial,is_enterprise,credit_band,credit_banners,period_start,period_end,revision,updated_at`;
    });
    if (!row)
      throw new BillingError(
        "BILLING_REVISION_CONFLICT",
        "The billing state changed concurrently.",
      );
    return safeState(row);
  }
  async function recordUsage(
    input: z.input<typeof usageInput>,
  ): Promise<UsageEntry> {
    const value = usageInput.parse(input);
    const quantity = BigInt(value.quantity);
    if (quantity > 9223372036854775807n)
      throw new BillingError(
        "INVALID_USAGE",
        "Usage quantity exceeds the PostgreSQL bigint limit.",
      );
    const occurredAt = value.occurredAt ?? null;
    const requestFingerprint = usageFingerprint({
      category: value.category,
      quantity,
      unit: value.unit,
      metadata: value.metadata,
      occurredAt,
    });
    const [row] = await sql<
      UsageRow[]
    >`insert into usage_ledger (id,owner_id,idempotency_key,fingerprint,category,quantity,unit,metadata,occurred_at) values (${newId<"usage-entry">()},${value.ownerId},${value.idempotencyKey},${requestFingerprint},${value.category},${quantity.toString()},${value.unit},${sql.json(value.metadata as never)},${value.occurredAt ?? sql`now()`}) on conflict (owner_id,idempotency_key) do nothing returning *`;
    if (row) return safeUsage(row);
    const [existing] = await sql<
      UsageRow[]
    >`select * from usage_ledger where owner_id=${value.ownerId} and idempotency_key=${value.idempotencyKey}`;
    if (existing && existing.fingerprint === requestFingerprint)
      return safeUsage(existing);
    throw new BillingError(
      "USAGE_CONFLICT",
      "The usage idempotency key is already bound to different usage.",
    );
  }
  async function summarize(
    ownerId: Id<"user">,
    start: Date,
    end: Date,
  ): Promise<UsageSummary[]> {
    if (
      !(start instanceof Date) ||
      Number.isNaN(start.getTime()) ||
      !(end instanceof Date) ||
      Number.isNaN(end.getTime()) ||
      start >= end
    )
      throw new BillingError(
        "INVALID_PERIOD",
        "The usage period must have a valid start before its end.",
      );
    const rows = await sql<
      { category: UsageCategory; unit: string; quantity: string }[]
    >`select category,unit,sum(quantity)::text as quantity from usage_ledger where owner_id=${idSchema.parse(ownerId)} and occurred_at >= ${start} and occurred_at < ${end} group by category,unit order by category,unit`;
    return rows;
  }
  return { get, setState, recordUsage, summarize };
}
export type BillingRepository = ReturnType<typeof createBillingRepository>;
