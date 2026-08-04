import { createHash } from "node:crypto";
import type { Sql } from "postgres";
import { z } from "zod";

import {
  asId,
  decodeCursor,
  encodeCursor,
  idSchema,
  type Id,
} from "@town/contracts";

import {
  resourceTypeSchema,
  type KnowledgeCitation,
  type ResourceType,
} from "./types.js";

const memoryScopeFilterSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("global") }).strict(),
  z.object({ scope: z.literal("routine"), routineId: idSchema }).strict(),
]);

const searchInputSchema = z
  .object({
    ownerId: idSchema,
    query: z.string().trim().min(1).max(500),
    types: z.array(resourceTypeSchema).min(1).optional(),
    memoryScope: memoryScopeFilterSchema.optional(),
    includeInactive: z.boolean().default(false),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict()
  .refine(
    (value) =>
      value.types === undefined ||
      new Set(value.types).size === value.types.length,
    { message: "Search resource types must be unique." },
  );

const searchCursorKeySchema = z
  .object({
    score: z.string().regex(/^\d+(?:\.\d+)?$/),
    updatedAt: z.iso.datetime(),
    resourceType: resourceTypeSchema,
    fingerprint: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();

const citationSourceTypeSchema = z.enum([
  "user",
  "account",
  "session",
  "web",
  "system",
]);

interface SearchRow {
  owner_id: string;
  resource_type: ResourceType;
  resource_id: string;
  title: string | null;
  search_text: string;
  subtype: string | null;
  scope_id: string | null;
  status: string;
  updated_at: Date;
  revision_id: string;
  score: string;
}

interface CitationRow {
  id: string;
  revision_id: string;
  source_type: string;
  source_ref: string;
  source_label: string | null;
  account_id: string | null;
  observed_at: Date;
}

export interface KnowledgeSearchResult {
  ownerId: Id<"user">;
  resourceType: ResourceType;
  resourceId: string;
  title: string | null;
  text: string;
  subtype: string | null;
  status: string;
  score: number;
  updatedAt: Date;
  citations: KnowledgeCitation[];
  source: {
    kind: "local_postgresql";
    algorithm: "postgres_full_text_v1";
  };
}

export interface KnowledgeSearchPage {
  items: KnowledgeSearchResult[];
  nextCursor: string | null;
}

export class KnowledgeSearchError extends Error {
  constructor(
    readonly code: "CURSOR_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "KnowledgeSearchError";
  }
}

function searchFingerprint(value: z.infer<typeof searchInputSchema>): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        ownerId: value.ownerId,
        query: value.query,
        types: [...(value.types ?? resourceTypeSchema.options)].sort(),
        memoryScope: value.memoryScope ?? null,
        includeInactive: value.includeInactive,
      }),
    )
    .digest("base64url");
}

function safeCitation(row: CitationRow): KnowledgeCitation {
  return {
    id: asId<"knowledge-citation">(row.id),
    sourceType: citationSourceTypeSchema.parse(row.source_type),
    sourceRef: row.source_ref,
    sourceLabel: row.source_label,
    accountId:
      row.account_id === null
        ? null
        : asId<"connected-account">(row.account_id),
    observedAt: row.observed_at,
  };
}

export function createKnowledgeSearchRepository(sql: Sql) {
  return {
    async search(input: {
      ownerId: Id<"user">;
      query: string;
      types?: ResourceType[];
      memoryScope?:
        { scope: "global" } | { scope: "routine"; routineId: Id<"routine"> };
      includeInactive?: boolean;
      cursor?: string;
      limit?: number;
    }): Promise<KnowledgeSearchPage> {
      const value = searchInputSchema.parse(input);
      const types = value.types ?? resourceTypeSchema.options;
      const fingerprint = searchFingerprint(value);
      const decodedCursor =
        value.cursor === undefined ? null : decodeCursor(value.cursor);
      const cursorKey =
        decodedCursor === null
          ? null
          : searchCursorKeySchema.parse(JSON.parse(decodedCursor.key));
      if (cursorKey !== null && cursorKey.fingerprint !== fingerprint) {
        throw new KnowledgeSearchError(
          "CURSOR_MISMATCH",
          "The search cursor belongs to a different query or filter set.",
        );
      }
      const cursorScore = cursorKey?.score ?? "0";
      const cursorUpdatedAt = cursorKey?.updatedAt ?? new Date(0).toISOString();
      const cursorResourceType = cursorKey?.resourceType ?? "profile";
      const cursorId =
        decodedCursor?.id ?? "00000000-0000-7000-8000-000000000000";
      const memoryScope = value.memoryScope?.scope ?? null;
      const routineId =
        value.memoryScope?.scope === "routine"
          ? value.memoryScope.routineId
          : null;

      const rows = await sql<SearchRow[]>`
        with candidates as (
          select
            p.owner_id,
            'profile'::text as resource_type,
            p.id as resource_id,
            'Profile'::text as title,
            p.content::text as search_text,
            null::text as subtype,
            null::uuid as scope_id,
            'active'::text as status,
            p.updated_at,
            kr.id as revision_id
          from profiles p
          join knowledge_revisions kr
            on kr.resource_type = 'profile' and kr.resource_id = p.id
            and kr.revision = p.current_revision
          where p.owner_id = ${value.ownerId}

          union all

          select
            m.owner_id,
            'memory'::text,
            m.id,
            null::text,
            m.content,
            m.scope,
            m.scope_id,
            m.status,
            m.updated_at,
            kr.id
          from memories m
          join knowledge_revisions kr
            on kr.resource_type = 'memory' and kr.resource_id = m.id
            and kr.revision = m.current_revision
          where m.owner_id = ${value.ownerId}

          union all

          select
            p.owner_id,
            'person'::text,
            p.id,
            p.display_name,
            p.display_name || ' ' || coalesce(p.organization, '') || ' ' ||
              coalesce(p.role, '') || ' ' || p.notes,
            p.category,
            null::uuid,
            p.status,
            p.updated_at,
            kr.id
          from people p
          join knowledge_revisions kr
            on kr.resource_type = 'person' and kr.resource_id = p.id
            and kr.revision = p.current_revision
          where p.owner_id = ${value.ownerId}

          union all

          select
            w.owner_id,
            'wiki'::text,
            w.id,
            w.title,
            w.title || ' ' || w.body,
            w.kind,
            null::uuid,
            w.status,
            w.updated_at,
            kr.id
          from wiki_documents w
          join knowledge_revisions kr
            on kr.resource_type = 'wiki' and kr.resource_id = w.id
            and kr.revision = w.current_revision
          where w.owner_id = ${value.ownerId}

          union all

          select
            g.owner_id,
            'goal'::text,
            g.id,
            g.title,
            g.title || ' ' || g.description,
            g.status,
            null::uuid,
            g.status,
            g.updated_at,
            kr.id
          from goals g
          join knowledge_revisions kr
            on kr.resource_type = 'goal' and kr.resource_id = g.id
            and kr.revision = g.current_revision
          where g.owner_id = ${value.ownerId}

          union all

          select
            pr.owner_id,
            'project'::text,
            pr.id,
            pr.title,
            pr.title || ' ' || pr.description,
            pr.status,
            pr.goal_id,
            pr.status,
            pr.updated_at,
            kr.id
          from projects pr
          join knowledge_revisions kr
            on kr.resource_type = 'project' and kr.resource_id = pr.id
            and kr.revision = pr.current_revision
          where pr.owner_id = ${value.ownerId}
        ), ranked as (
          select
            candidates.*,
            round(
              ts_rank_cd(
                to_tsvector('simple', search_text),
                websearch_to_tsquery('simple', ${value.query})
              )::numeric,
              8
            ) as score
          from candidates
          where to_tsvector('simple', search_text)
            @@ websearch_to_tsquery('simple', ${value.query})
        )
        select *
        from ranked
        where resource_type = any(${sql.array(types)}::text[])
          and (${value.includeInactive} or status = 'active')
          and (
            ${memoryScope}::text is null or resource_type <> 'memory' or
            (
              subtype = ${memoryScope} and
              (${memoryScope} <> 'routine' or scope_id = ${routineId}::uuid)
            )
          )
          and (
            ${cursorKey === null} or
            score < ${cursorScore}::numeric or
            (score = ${cursorScore}::numeric and updated_at < ${cursorUpdatedAt}::timestamptz) or
            (
              score = ${cursorScore}::numeric and
              updated_at = ${cursorUpdatedAt}::timestamptz and
              resource_type > ${cursorResourceType}
            ) or
            (
              score = ${cursorScore}::numeric and
              updated_at = ${cursorUpdatedAt}::timestamptz and
              resource_type = ${cursorResourceType} and resource_id > ${cursorId}::uuid
            )
          )
        order by score desc, updated_at desc, resource_type, resource_id
        limit ${value.limit + 1}
      `;

      const hasMore = rows.length > value.limit;
      const pageRows = hasMore ? rows.slice(0, value.limit) : rows;
      const revisionIds = pageRows.map(({ revision_id }) => revision_id);
      const citationRows =
        revisionIds.length === 0
          ? []
          : await sql<CitationRow[]>`
              select * from knowledge_citations
              where owner_id = ${value.ownerId}
                and revision_id in ${sql(revisionIds)}
              order by created_at, id
            `;
      const citationsByRevision = new Map<string, KnowledgeCitation[]>();
      for (const citation of citationRows) {
        const values = citationsByRevision.get(citation.revision_id) ?? [];
        values.push(safeCitation(citation));
        citationsByRevision.set(citation.revision_id, values);
      }

      const items = pageRows.map<KnowledgeSearchResult>((row) => ({
        ownerId: asId<"user">(row.owner_id),
        resourceType: resourceTypeSchema.parse(row.resource_type),
        resourceId: row.resource_id,
        title: row.title,
        text: row.search_text,
        subtype: row.subtype,
        status: row.status,
        score: Number(row.score),
        updatedAt: row.updated_at,
        citations: citationsByRevision.get(row.revision_id) ?? [],
        source: {
          kind: "local_postgresql",
          algorithm: "postgres_full_text_v1",
        },
      }));
      const last = hasMore ? pageRows.at(-1) : undefined;
      const nextCursor =
        last === undefined
          ? null
          : encodeCursor({
              version: 1,
              key: JSON.stringify({
                score: last.score,
                updatedAt: last.updated_at.toISOString(),
                resourceType: last.resource_type,
                fingerprint,
              }),
              id: asId(last.resource_id),
            });

      return { items, nextCursor };
    },
  };
}

export type KnowledgeSearchRepository = ReturnType<
  typeof createKnowledgeSearchRepository
>;
