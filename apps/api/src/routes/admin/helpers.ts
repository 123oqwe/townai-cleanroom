import type { Context } from "hono";
import { z } from "zod";

import type { AuthVariables } from "../../lib/auth.js";
import {
  type ReportSlug,
  type RoutineReportSlug,
  reportSlugSet,
  routineReportSlugSet,
} from "./types.js";

export const periodQuerySchema = z
  .object({
    start: z.iso.date().optional(),
    end: z.iso.date().optional(),
    cursor: z.string().trim().min(1).max(500).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export function resolvePeriod(query: Record<string, string | undefined>) {
  const parsed = periodQuerySchema.parse(query);
  const now = new Date();
  const end = parsed.end !== undefined ? new Date(parsed.end) : now;
  const start =
    parsed.start !== undefined
      ? new Date(parsed.start)
      : new Date(end.getTime() - 30 * 86_400_000);
  if (start > end) throw new Error("PERIOD_START_AFTER_END");
  return { start, end, cursor: parsed.cursor, limit: parsed.limit };
}

export function reportNotFound(context: Context<{ Variables: AuthVariables }>) {
  return context.json({ code: "REPORT_NOT_FOUND" }, 404);
}

export function parseReportSlug(
  candidate: string | undefined,
): ReportSlug | null {
  if (candidate === undefined || !reportSlugSet.has(candidate as ReportSlug))
    return null;
  return candidate as ReportSlug;
}

export function parseRoutineReportSlug(
  candidate: string | undefined,
): RoutineReportSlug | null {
  if (
    candidate === undefined ||
    !routineReportSlugSet.has(candidate as RoutineReportSlug)
  )
    return null;
  return candidate as RoutineReportSlug;
}
