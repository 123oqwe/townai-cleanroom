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
  quantity: number;
  unit: string;
  metadata: Record<string, unknown>;
  occurredAt: Date;
}
export interface UsageSummary {
  category: UsageCategory;
  quantity: number;
  unit: string;
}
export class BillingError extends Error {
  constructor(
    readonly code:
      "BILLING_NOT_CONFIGURED" | "USAGE_CONFLICT" | "BILLING_REVISION_CONFLICT",
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
  category: UsageCategory;
  quantity: number;
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
    expectedRevision: z.number().int().positive().optional(),
  })
  .strict();
const usageInput = z
  .object({
    ownerId: idSchema,
    idempotencyKey: z.string().trim().min(1).max(500),
    category: usageCategorySchema,
    quantity: z.number().int().positive(),
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
    quantity: row.quantity,
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
    const [row] = await sql<
      StateRow[]
    >`insert into billing_accounts (owner_id,plan_name,is_blocked,is_trial,is_enterprise,credit_band,credit_banners,period_start,period_end) values (${value.ownerId},${value.planName},${value.isBlocked},${value.isTrial},${value.isEnterprise},${value.creditBand},${sql.json(value.creditBanners)},${value.periodStart ?? null},${value.periodEnd ?? null}) on conflict (owner_id) do update set plan_name=excluded.plan_name,is_blocked=excluded.is_blocked,is_trial=excluded.is_trial,is_enterprise=excluded.is_enterprise,credit_band=excluded.credit_band,credit_banners=excluded.credit_banners,period_start=excluded.period_start,period_end=excluded.period_end,revision=billing_accounts.revision+1,updated_at=now() where ${value.expectedRevision === undefined ? sql`true` : sql`billing_accounts.revision=${value.expectedRevision}`} returning owner_id,plan_name,is_blocked,is_trial,is_enterprise,credit_band,credit_banners,period_start,period_end,revision,updated_at`;
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
    const [row] = await sql<
      UsageRow[]
    >`insert into usage_ledger (id,owner_id,idempotency_key,category,quantity,unit,metadata,occurred_at) values (${newId<"usage-entry">()},${value.ownerId},${value.idempotencyKey},${value.category},${value.quantity},${value.unit},${sql.json(value.metadata as never)},${value.occurredAt ?? sql`now()`}) on conflict (owner_id,idempotency_key) do nothing returning *`;
    if (row) return safeUsage(row);
    const [existing] = await sql<
      UsageRow[]
    >`select * from usage_ledger where owner_id=${value.ownerId} and idempotency_key=${value.idempotencyKey}`;
    if (
      existing &&
      existing.category === value.category &&
      existing.quantity === value.quantity &&
      existing.unit === value.unit &&
      JSON.stringify(canonical(existing.metadata)) ===
        JSON.stringify(canonical(value.metadata))
    )
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
    const rows = await sql<
      { category: UsageCategory; unit: string; quantity: number }[]
    >`select category,unit,sum(quantity)::int as quantity from usage_ledger where owner_id=${idSchema.parse(ownerId)} and occurred_at >= ${start} and occurred_at < ${end} group by category,unit order by category,unit`;
    return rows;
  }
  return { get, setState, recordUsage, summarize };
}
export type BillingRepository = ReturnType<typeof createBillingRepository>;
