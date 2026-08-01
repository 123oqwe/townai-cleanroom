import type { Sql } from "postgres";
import { z } from "zod";

import { asId, idSchema, newId, type Id } from "@town/contracts";

import { createRevisionRepository } from "./revision-repository.js";
import {
  authorTypeSchema,
  citationInputSchema,
  type AuthorType,
  type CitationInput,
  type JsonValue,
  type KnowledgeConflict,
} from "./types.js";

const wikiKindSchema = z.enum(["profile", "goal", "project", "page"]);
const wikiFields = {
  ownerId: idSchema,
  kind: wikiKindSchema,
  slug: z.string().trim().min(1),
  title: z.string().trim().min(1),
  body: z.string(),
  authorType: authorTypeSchema,
  citations: z.array(citationInputSchema),
};
const wikiCreateSchema = z.object(wikiFields).strict();
const wikiUpdateSchema = z
  .object({
    ...wikiFields,
    documentId: idSchema,
    expectedRevision: z.number().int().positive(),
  })
  .strict();

interface WikiRow {
  id: string;
  owner_id: string;
  kind: z.infer<typeof wikiKindSchema>;
  slug: string;
  title: string;
  body: string;
  status: "active" | "retired";
  current_revision: number;
  created_at: Date;
  updated_at: Date;
}

export interface WikiDocument {
  id: Id<"wiki">;
  ownerId: Id<"user">;
  kind: z.infer<typeof wikiKindSchema>;
  slug: string;
  title: string;
  body: string;
  status: "active" | "retired";
  currentRevision: number;
  createdAt: Date;
  updatedAt: Date;
}

export class WikiError extends Error {
  constructor(
    readonly code: "WIKI_DOCUMENT_ALREADY_EXISTS" | "WIKI_DOCUMENT_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "WikiError";
  }
}

function safeWiki(row: WikiRow): WikiDocument {
  return {
    id: asId<"wiki">(row.id),
    ownerId: asId<"user">(row.owner_id),
    kind: row.kind,
    slug: row.slug,
    title: row.title,
    body: row.body,
    status: row.status,
    currentRevision: row.current_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function wikiSnapshot(
  value: z.infer<typeof wikiCreateSchema>,
  status: "active" | "retired",
) {
  return {
    kind: value.kind,
    slug: value.slug,
    title: value.title,
    body: value.body,
    status,
  } satisfies Record<string, JsonValue>;
}

export function createWikiRepository(sql: Sql) {
  const revisions = createRevisionRepository(sql);

  async function get(
    ownerId: Id<"user">,
    documentId: Id<"wiki">,
  ): Promise<WikiDocument> {
    const values = z
      .object({ ownerId: idSchema, documentId: idSchema })
      .parse({ ownerId, documentId });
    const rows = await sql<WikiRow[]>`
      select * from wiki_documents
      where id = ${values.documentId} and owner_id = ${values.ownerId}
    `;
    const row = rows[0];
    if (row === undefined) {
      throw new WikiError(
        "WIKI_DOCUMENT_NOT_FOUND",
        "The Wiki document was not found.",
      );
    }
    return safeWiki(row);
  }

  async function create(input: {
    ownerId: Id<"user">;
    kind: WikiDocument["kind"];
    slug: string;
    title: string;
    body: string;
    authorType: AuthorType;
    citations: CitationInput[];
  }): Promise<WikiDocument> {
    const value = wikiCreateSchema.parse(input);
    const documentId = newId<"wiki">();
    try {
      await revisions.createInitial({
        ownerId: asId<"user">(value.ownerId),
        resourceType: "wiki",
        resourceId: documentId,
        authorType: value.authorType,
        snapshot: wikiSnapshot(value, "active"),
        citations: value.citations,
        applySnapshot: async (transaction) => {
          await transaction`
            insert into wiki_documents (
              id, owner_id, kind, slug, title, body, status, current_revision
            ) values (
              ${documentId}, ${value.ownerId}, ${value.kind}, ${value.slug},
              ${value.title}, ${value.body}, 'active', 1
            )
          `;
        },
      });
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "constraint_name" in error &&
        error.constraint_name === "wiki_documents_owner_kind_slug_unique"
      ) {
        throw new WikiError(
          "WIKI_DOCUMENT_ALREADY_EXISTS",
          "A Wiki document with this kind and slug already exists.",
        );
      }
      throw error;
    }
    return get(asId<"user">(value.ownerId), documentId);
  }

  async function update(input: {
    ownerId: Id<"user">;
    documentId: Id<"wiki">;
    expectedRevision: number;
    kind: WikiDocument["kind"];
    slug: string;
    title: string;
    body: string;
    authorType: AuthorType;
    citations: CitationInput[];
  }): Promise<
    | { kind: "applied"; document: WikiDocument }
    | { kind: "conflict"; conflict: KnowledgeConflict }
  > {
    const value = wikiUpdateSchema.parse(input);
    const documentId = asId<"wiki">(value.documentId);
    const current = await get(asId<"user">(value.ownerId), documentId);
    const result = await revisions.append({
      ownerId: asId<"user">(value.ownerId),
      resourceType: "wiki",
      resourceId: documentId,
      expectedRevision: value.expectedRevision,
      authorType: value.authorType,
      snapshot: wikiSnapshot(value, current.status),
      citations: value.citations,
      applySnapshot: async (transaction, _snapshot, revision) => {
        const rows = await transaction<WikiRow[]>`
          update wiki_documents
          set kind = ${value.kind}, slug = ${value.slug},
              title = ${value.title}, body = ${value.body},
              current_revision = ${revision}, updated_at = now()
          where id = ${documentId} and owner_id = ${value.ownerId}
            and current_revision = ${value.expectedRevision}
          returning *
        `;
        if (rows.length !== 1) {
          throw new Error("Wiki revision state is inconsistent.");
        }
      },
    });
    if (result.kind === "conflict") return result;
    return {
      kind: "applied",
      document: await get(asId<"user">(value.ownerId), documentId),
    };
  }

  return {
    create,
    get,
    update,

    async list(
      ownerId: Id<"user">,
      filter?: {
        kind?: WikiDocument["kind"];
        includeRetired?: boolean;
      },
    ): Promise<WikiDocument[]> {
      const validOwnerId = asId<"user">(ownerId);
      const rows = await sql<WikiRow[]>`
        select * from wiki_documents
        where owner_id = ${validOwnerId}
          and (${filter?.kind ?? null}::text is null or kind = ${filter?.kind ?? null})
          and (${filter?.includeRetired ?? false} or status = 'active')
        order by created_at, id
      `;
      return rows.map(safeWiki);
    },

    async retire(input: {
      ownerId: Id<"user">;
      documentId: Id<"wiki">;
      expectedRevision: number;
      authorType: AuthorType;
      citations: CitationInput[];
    }): Promise<WikiDocument> {
      const current = await get(input.ownerId, input.documentId);
      const snapshot = {
        kind: current.kind,
        slug: current.slug,
        title: current.title,
        body: current.body,
        status: "retired",
      } satisfies Record<string, JsonValue>;
      const result = await revisions.append({
        ownerId: input.ownerId,
        resourceType: "wiki",
        resourceId: input.documentId,
        expectedRevision: input.expectedRevision,
        authorType: input.authorType,
        snapshot,
        citations: input.citations,
        applySnapshot: async (transaction, _snapshot, revision) => {
          const rows = await transaction<WikiRow[]>`
            update wiki_documents
            set status = 'retired', current_revision = ${revision},
                updated_at = now()
            where id = ${input.documentId} and owner_id = ${input.ownerId}
              and current_revision = ${input.expectedRevision}
            returning *
          `;
          if (rows.length !== 1) {
            throw new Error("Wiki revision state is inconsistent.");
          }
        },
      });
      if (result.kind === "conflict") {
        throw new Error("A user retirement unexpectedly produced a conflict.");
      }
      return get(input.ownerId, input.documentId);
    },
  };
}

export type WikiRepository = ReturnType<typeof createWikiRepository>;
