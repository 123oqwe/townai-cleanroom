import { z } from "zod";

import { type Id } from "@town/contracts";

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
