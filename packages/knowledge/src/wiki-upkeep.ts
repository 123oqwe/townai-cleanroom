import type { Sql } from "postgres";
import { z } from "zod";

import { asId, idSchema, type Id } from "@town/contracts";

const scanInputSchema = z
  .object({
    ownerId: idSchema,
    staleAfterDays: z.number().int().min(1).max(3650).default(30),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();

export interface WikiUpkeepCandidate {
  resourceType: "memory" | "wiki";
  resourceId: string;
  title: string | null;
  reason: "expired" | "not_observed_recently" | "not_updated_recently";
  currentRevision: number;
  lastObservedAt: Date | null;
  updatedAt: Date;
}

export interface WikiUpkeepReport {
  ownerId: Id<"user">;
  generatedAt: Date;
  staleAfterDays: number;
  candidates: WikiUpkeepCandidate[];
}

/**
 * Finds knowledge that may need nightly review without mutating it. A real
 * extraction/provider job can turn a candidate into a revision-aware proposal;
 * this scanner never invents replacement content or silently retires data.
 */
export function createWikiUpkeepScanner(sql: Sql) {
  return {
    async scan(input: {
      ownerId: Id<"user">;
      staleAfterDays?: number;
      limit?: number;
    }): Promise<WikiUpkeepReport> {
      const value = scanInputSchema.parse(input);
      const rows = await sql<
        {
          resource_type: "memory" | "wiki";
          resource_id: string;
          title: string | null;
          reason: WikiUpkeepCandidate["reason"];
          current_revision: number;
          last_observed_at: Date | null;
          updated_at: Date;
        }[]
      >`
        with candidates as (
          select
            'memory'::text as resource_type,
            m.id as resource_id,
            null::text as title,
            case
              when m.expires_at is not null and m.expires_at <= now() then 'expired'
              else 'not_observed_recently'
            end::text as reason,
            m.current_revision,
            m.observed_at as last_observed_at,
            m.updated_at
          from memories m
          where m.owner_id=${value.ownerId}
            and m.status='active'
            and (
              (m.expires_at is not null and m.expires_at <= now()) or
              m.observed_at < now() - (${value.staleAfterDays} * interval '1 day')
            )
          union all
          select
            'wiki'::text,
            w.id,
            w.title,
            'not_updated_recently'::text,
            w.current_revision,
            null::timestamptz,
            w.updated_at
          from wiki_documents w
          where w.owner_id=${value.ownerId}
            and w.status='active'
            and w.updated_at < now() - (${value.staleAfterDays} * interval '1 day')
        )
        select * from candidates
        order by updated_at asc, resource_type, resource_id
        limit ${value.limit}
      `;
      return {
        ownerId: asId<"user">(value.ownerId),
        generatedAt: new Date(),
        staleAfterDays: value.staleAfterDays,
        candidates: rows.map((row) => ({
          resourceType: row.resource_type,
          resourceId: row.resource_id,
          title: row.title,
          reason: row.reason,
          currentRevision: row.current_revision,
          lastObservedAt: row.last_observed_at,
          updatedAt: row.updated_at,
        })),
      };
    },
  };
}

export type WikiUpkeepScanner = ReturnType<typeof createWikiUpkeepScanner>;
