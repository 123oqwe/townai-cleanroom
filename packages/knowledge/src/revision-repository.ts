import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";

import { asId, idSchema, newId, type Id } from "@town/contracts";

import {
  authorTypeSchema,
  citationInputSchema,
  resourceTypeSchema,
  snapshotSchema,
  type AuthorType,
  type CitationInput,
  type JsonValue,
  type KnowledgeCitation,
  type KnowledgeConflict,
  type KnowledgeRevision,
  type ResourceType,
} from "./types.js";

const revisionInputSchema = z
  .object({
    ownerId: idSchema,
    resourceType: resourceTypeSchema,
    resourceId: idSchema,
    authorType: authorTypeSchema,
    snapshot: snapshotSchema,
    citations: z.array(citationInputSchema),
    changeReason: z.string().trim().min(1).optional(),
  })
  .strict();

const appendInputSchema = revisionInputSchema.extend({
  expectedRevision: z.number().int().positive(),
});

interface RevisionRow {
  id: string;
  owner_id: string;
  resource_type: string;
  resource_id: string;
  revision: number;
  base_revision: number;
  author_type: string;
  snapshot: Record<string, JsonValue>;
  change_reason: string | null;
  created_at: Date;
}

interface CitationRow {
  id: string;
  revision_id: string;
  source_type: CitationInput["sourceType"];
  source_ref: string;
  source_label: string | null;
  account_id: string | null;
  observed_at: Date;
}

interface ConflictRow {
  id: string;
  owner_id: string;
  resource_type: string;
  resource_id: string;
  base_revision: number;
  current_revision: number;
  proposed_author_type: "assistant" | "system";
  proposed_snapshot: Record<string, JsonValue>;
  proposed_citations: SerializedCitation[];
  status: "pending" | "resolved" | "rejected";
  created_at: Date;
  resolved_at: Date | null;
}

interface SerializedCitation {
  [key: string]: string | null;
  sourceType: CitationInput["sourceType"];
  sourceRef: string;
  sourceLabel: string | null;
  accountId: string | null;
  observedAt: string;
}

export class RevisionError extends Error {
  constructor(
    readonly code:
      | "CONFLICT_NOT_FOUND"
      | "REVISION_ALREADY_EXISTS"
      | "REVISION_CONFLICT"
      | "RESOURCE_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "RevisionError";
  }
}

function serializeCitation(citation: CitationInput): SerializedCitation {
  return {
    sourceType: citation.sourceType,
    sourceRef: citation.sourceRef,
    sourceLabel: citation.sourceLabel ?? null,
    accountId: citation.accountId ?? null,
    observedAt: citation.observedAt.toISOString(),
  };
}

function deserializeCitation(citation: SerializedCitation): CitationInput {
  return citationInputSchema.parse({
    sourceType: citation.sourceType,
    sourceRef: citation.sourceRef,
    ...(citation.sourceLabel === null
      ? {}
      : { sourceLabel: citation.sourceLabel }),
    ...(citation.accountId === null ? {} : { accountId: citation.accountId }),
    observedAt: new Date(citation.observedAt),
  });
}

function safeCitation(row: CitationRow): KnowledgeCitation {
  return {
    id: asId<"knowledge-citation">(row.id),
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    sourceLabel: row.source_label,
    accountId:
      row.account_id === null
        ? null
        : asId<"connected-account">(row.account_id),
    observedAt: row.observed_at,
  };
}

function safeConflict(row: ConflictRow): KnowledgeConflict {
  return {
    id: asId<"knowledge-conflict">(row.id),
    ownerId: asId<"user">(row.owner_id),
    resourceType: resourceTypeSchema.parse(row.resource_type),
    resourceId: row.resource_id,
    baseRevision: row.base_revision,
    currentRevision: row.current_revision,
    proposedAuthorType: row.proposed_author_type,
    proposedSnapshot: row.proposed_snapshot,
    proposedCitations: row.proposed_citations.map(deserializeCitation),
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

async function insertCitations(
  transaction: TransactionSql,
  ownerId: Id<"user">,
  revisionId: Id<"knowledge-revision">,
  citations: CitationInput[],
): Promise<void> {
  for (const citation of citations) {
    await transaction`
      insert into knowledge_citations (
        id, owner_id, revision_id, source_type, source_ref, source_label,
        account_id, observed_at
      ) values (
        ${newId<"knowledge-citation">()}, ${ownerId}, ${revisionId},
        ${citation.sourceType}, ${citation.sourceRef},
        ${citation.sourceLabel ?? null}, ${citation.accountId ?? null},
        ${citation.observedAt}
      )
    `;
  }
}

async function lockResource(
  transaction: TransactionSql,
  ownerId: string,
  resourceType: ResourceType,
  resourceId: string,
): Promise<void> {
  const lockKey = `${ownerId}:${resourceType}:${resourceId}`;
  await transaction`
    select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
  `;
}

async function insertRevision(
  transaction: TransactionSql,
  input: z.infer<typeof revisionInputSchema>,
  revision: number,
  baseRevision: number,
): Promise<RevisionRow> {
  const revisionId = newId<"knowledge-revision">();
  const rows = await transaction<RevisionRow[]>`
    insert into knowledge_revisions (
      id, owner_id, resource_type, resource_id, revision, base_revision,
      author_type, snapshot, change_reason
    ) values (
      ${revisionId}, ${input.ownerId}, ${input.resourceType}, ${input.resourceId},
      ${revision}, ${baseRevision}, ${input.authorType},
      ${transaction.json(input.snapshot)}, ${input.changeReason ?? null}
    )
    returning *
  `;
  await insertCitations(
    transaction,
    asId<"user">(input.ownerId),
    revisionId,
    input.citations,
  );
  const row = rows[0];
  if (row === undefined) throw new Error("Revision insert returned no row.");
  return row;
}

async function hydrateRevisions(
  sql: Sql,
  rows: RevisionRow[],
): Promise<KnowledgeRevision[]> {
  const revisionIds = rows.map(({ id }) => id);
  const citations =
    revisionIds.length === 0
      ? []
      : await sql<CitationRow[]>`
          select * from knowledge_citations
          where revision_id in ${sql(revisionIds)}
          order by created_at, id
        `;
  const citationsByRevision = new Map<string, KnowledgeCitation[]>();
  for (const citation of citations) {
    const values = citationsByRevision.get(citation.revision_id) ?? [];
    values.push(safeCitation(citation));
    citationsByRevision.set(citation.revision_id, values);
  }

  return rows.map((row) => ({
    id: asId<"knowledge-revision">(row.id),
    ownerId: asId<"user">(row.owner_id),
    resourceType: resourceTypeSchema.parse(row.resource_type),
    resourceId: row.resource_id,
    revision: row.revision,
    baseRevision: row.base_revision,
    authorType: authorTypeSchema.parse(row.author_type),
    snapshot: row.snapshot,
    changeReason: row.change_reason,
    createdAt: row.created_at,
    citations: citationsByRevision.get(row.id) ?? [],
  }));
}

export function createRevisionRepository(sql: Sql) {
  return {
    async createInitial(input: {
      ownerId: Id<"user">;
      resourceType: ResourceType;
      resourceId: string;
      authorType: AuthorType;
      snapshot: Record<string, JsonValue>;
      citations: CitationInput[];
      changeReason?: string;
      applySnapshot?: (
        transaction: TransactionSql,
        snapshot: Record<string, JsonValue>,
        revision: number,
      ) => Promise<void>;
    }): Promise<KnowledgeRevision> {
      const { applySnapshot, ...revisionInput } = input;
      const value = revisionInputSchema.parse(revisionInput);
      try {
        const row = await sql.begin(async (transaction) => {
          const inserted = await insertRevision(transaction, value, 1, 0);
          await applySnapshot?.(transaction, value.snapshot, inserted.revision);
          return inserted;
        });
        const [revision] = await hydrateRevisions(sql, [row]);
        if (revision === undefined)
          throw new Error("Revision hydration failed.");
        return revision;
      } catch (error: unknown) {
        if (
          typeof error === "object" &&
          error !== null &&
          "constraint_name" in error &&
          error.constraint_name ===
            "knowledge_revisions_resource_revision_unique"
        ) {
          throw new RevisionError(
            "REVISION_ALREADY_EXISTS",
            "The resource already has a revision history.",
          );
        }
        throw error;
      }
    },

    async append(input: {
      ownerId: Id<"user">;
      resourceType: ResourceType;
      resourceId: string;
      expectedRevision: number;
      authorType: AuthorType;
      snapshot: Record<string, JsonValue>;
      citations: CitationInput[];
      changeReason?: string;
      applySnapshot?: (
        transaction: TransactionSql,
        snapshot: Record<string, JsonValue>,
        revision: number,
      ) => Promise<void>;
    }): Promise<
      | { kind: "applied"; revision: KnowledgeRevision }
      | { kind: "conflict"; conflict: KnowledgeConflict }
    > {
      const { applySnapshot, ...revisionInput } = input;
      const value = appendInputSchema.parse(revisionInput);
      const result = await sql.begin(async (transaction) => {
        await lockResource(
          transaction,
          value.ownerId,
          value.resourceType,
          value.resourceId,
        );
        const rows = await transaction<RevisionRow[]>`
          select * from knowledge_revisions
          where owner_id = ${value.ownerId}
            and resource_type = ${value.resourceType}
            and resource_id = ${value.resourceId}
          order by revision desc
          limit 1
          for update
        `;
        const latest = rows[0];
        if (latest === undefined) {
          throw new RevisionError(
            "RESOURCE_NOT_FOUND",
            "The knowledge resource was not found.",
          );
        }

        if (latest.revision !== value.expectedRevision) {
          if (value.authorType === "user") {
            throw new RevisionError(
              "REVISION_CONFLICT",
              "The knowledge resource changed after it was read.",
            );
          }
          const conflictRows = await transaction<ConflictRow[]>`
            insert into knowledge_conflicts (
              id, owner_id, resource_type, resource_id, base_revision,
              current_revision, proposed_author_type, proposed_snapshot,
              proposed_citations
            ) values (
              ${newId<"knowledge-conflict">()}, ${value.ownerId},
              ${value.resourceType}, ${value.resourceId},
              ${value.expectedRevision}, ${latest.revision}, ${value.authorType},
              ${transaction.json(value.snapshot)},
              ${transaction.json(value.citations.map(serializeCitation))}
            )
            returning *
          `;
          const conflict = conflictRows[0];
          if (conflict === undefined)
            throw new Error("Conflict insert returned no row.");
          return {
            kind: "conflict" as const,
            conflict: safeConflict(conflict),
          };
        }

        const row = await insertRevision(
          transaction,
          value,
          latest.revision + 1,
          latest.revision,
        );
        await applySnapshot?.(transaction, value.snapshot, row.revision);
        return { kind: "applied-row" as const, row };
      });

      if (result.kind === "conflict") return result;
      const [revision] = await hydrateRevisions(sql, [result.row]);
      if (revision === undefined) throw new Error("Revision hydration failed.");
      return { kind: "applied", revision };
    },

    async list(
      ownerId: Id<"user">,
      resourceType: ResourceType,
      resourceId: string,
    ): Promise<KnowledgeRevision[]> {
      const values = z
        .object({
          ownerId: idSchema,
          resourceType: resourceTypeSchema,
          resourceId: idSchema,
        })
        .parse({ ownerId, resourceType, resourceId });
      const rows = await sql<RevisionRow[]>`
        select * from knowledge_revisions
        where owner_id = ${values.ownerId}
          and resource_type = ${values.resourceType}
          and resource_id = ${values.resourceId}
        order by revision
      `;
      if (rows.length === 0) {
        throw new RevisionError(
          "RESOURCE_NOT_FOUND",
          "The knowledge resource was not found.",
        );
      }
      return hydrateRevisions(sql, rows);
    },

    async listConflicts(ownerId: Id<"user">): Promise<KnowledgeConflict[]> {
      const validOwnerId = asId<"user">(ownerId);
      const rows = await sql<ConflictRow[]>`
        select * from knowledge_conflicts
        where owner_id = ${validOwnerId}
        order by created_at, id
      `;
      return rows.map(safeConflict);
    },

    async resolveConflict(input: {
      ownerId: Id<"user">;
      conflictId: Id<"knowledge-conflict">;
      expectedRevision: number;
      resolution: "accept" | "reject";
      applySnapshot?: (
        transaction: TransactionSql,
        snapshot: Record<string, JsonValue>,
        revision: number,
      ) => Promise<void>;
    }): Promise<
      | { kind: "resolved"; revision: KnowledgeRevision }
      | { kind: "rejected"; conflict: KnowledgeConflict }
    > {
      const value = z
        .object({
          ownerId: idSchema,
          conflictId: idSchema,
          expectedRevision: z.number().int().positive(),
          resolution: z.enum(["accept", "reject"]),
        })
        .parse(input);
      const result = await sql.begin(async (transaction) => {
        const conflictRows = await transaction<ConflictRow[]>`
          select * from knowledge_conflicts
          where id = ${value.conflictId} and owner_id = ${value.ownerId}
            and status = 'pending'
          for update
        `;
        const conflict = conflictRows[0];
        if (conflict === undefined) {
          throw new RevisionError(
            "CONFLICT_NOT_FOUND",
            "The pending knowledge conflict was not found.",
          );
        }
        await lockResource(
          transaction,
          value.ownerId,
          resourceTypeSchema.parse(conflict.resource_type),
          conflict.resource_id,
        );
        const latestRows = await transaction<RevisionRow[]>`
          select * from knowledge_revisions
          where owner_id = ${value.ownerId}
            and resource_type = ${conflict.resource_type}
            and resource_id = ${conflict.resource_id}
          order by revision desc
          limit 1
          for update
        `;
        const latest = latestRows[0];
        if (latest === undefined) {
          throw new RevisionError(
            "RESOURCE_NOT_FOUND",
            "The knowledge resource was not found.",
          );
        }
        if (latest.revision !== value.expectedRevision) {
          throw new RevisionError(
            "REVISION_CONFLICT",
            "The knowledge resource changed after the conflict was read.",
          );
        }

        if (value.resolution === "reject") {
          const rows = await transaction<ConflictRow[]>`
            update knowledge_conflicts
            set status = 'rejected', resolved_at = now()
            where id = ${value.conflictId} and owner_id = ${value.ownerId}
            returning *
          `;
          const rejected = rows[0];
          if (rejected === undefined) {
            throw new Error("Conflict update returned no row.");
          }
          return {
            kind: "rejected" as const,
            conflict: safeConflict(rejected),
          };
        }

        const revisionInput = revisionInputSchema.parse({
          ownerId: value.ownerId,
          resourceType: conflict.resource_type,
          resourceId: conflict.resource_id,
          authorType: "user",
          snapshot: conflict.proposed_snapshot,
          citations: conflict.proposed_citations.map(deserializeCitation),
          changeReason: "Accepted proposed knowledge change",
        });
        const row = await insertRevision(
          transaction,
          revisionInput,
          latest.revision + 1,
          latest.revision,
        );
        await input.applySnapshot?.(
          transaction,
          conflict.proposed_snapshot,
          row.revision,
        );
        await transaction`
          update knowledge_conflicts
          set status = 'resolved', resolution_revision = ${row.revision},
              resolved_at = now()
          where id = ${value.conflictId} and owner_id = ${value.ownerId}
        `;
        return { kind: "resolved-row" as const, row };
      });

      if (result.kind === "rejected") return result;
      const [revision] = await hydrateRevisions(sql, [result.row]);
      if (revision === undefined) throw new Error("Revision hydration failed.");
      return { kind: "resolved", revision };
    },
  };
}

export type RevisionRepository = ReturnType<typeof createRevisionRepository>;
