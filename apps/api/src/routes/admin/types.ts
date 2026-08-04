import { z } from "zod";

import type { Sql } from "postgres";
import type { OperationsRepository } from "@town/operations";
import type { BillingRepository } from "@town/billing";

export type ContentStorageReadiness = boolean | "read-only";

export interface AdminDependencies {
  sql: Sql;
  operations: OperationsRepository;
  harnessReady: boolean;
  workerEnabled: boolean;
  googleOAuthReady: boolean;
  microsoftOAuthReady: boolean;
  slackEvents: boolean;
  telegramEvents: boolean;
  whatsappEvents: boolean;
  twilioVoice: boolean;
  vapiVoice: boolean;
  voiceSynthesis: boolean;
  contentStorage: ContentStorageReadiness;
  workspaceTools: boolean;
  codeRunner: boolean;
  e2bSandbox: boolean;
  pipedreamCatalog: boolean;
  billing?: BillingRepository;
}

const reportSlugs = [
  "overview",
  "runtime",
  "delivery",
  "safety",
  "teams",
  "content",
  "billing",
] as const;
export type ReportSlug = (typeof reportSlugs)[number];
export const reportSlugSet = new Set<ReportSlug>(reportSlugs);

const routineReportSlugs = [
  "overview",
  "schedules",
  "triggers",
  "runs",
  "webhooks",
  "shares",
] as const;
export type RoutineReportSlug = (typeof routineReportSlugs)[number];
export const routineReportSlugSet = new Set<RoutineReportSlug>(
  routineReportSlugs,
);

export const userIdSchema = z.uuidv7();
