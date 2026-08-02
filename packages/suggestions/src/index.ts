import { createHash } from "node:crypto";
import type { Sql } from "postgres";
import { z } from "zod";

import { asId, idSchema, newId, type Id } from "@town/contracts";

export const suggestionKindSchema = z.enum(["assistant", "task", "routine"]);
export const suggestionStatusSchema = z.enum([
  "open",
  "dismissed",
  "converted",
]);
export type SuggestionKind = z.infer<typeof suggestionKindSchema>;
export type SuggestionStatus = z.infer<typeof suggestionStatusSchema>;

export interface Suggestion {
  id: Id<"suggestion">;
  ownerId: Id<"user">;
  kind: SuggestionKind;
  status: SuggestionStatus;
  title: string;
  body: string;
  sourceType: string;
  sourceRef: string;
  metadata: Record<string, unknown>;
  revision: number;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class SuggestionError extends Error {
  constructor(
    readonly code: "SUGGESTION_NOT_FOUND" | "SUGGESTION_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "SuggestionError";
  }
}

type Row = {
  id: string;
  owner_id: string;
  kind: SuggestionKind;
  status: SuggestionStatus;
  title: string;
  body: string;
  source_type: string;
  source_ref: string;
  metadata: Record<string, unknown>;
  revision: number;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
};
const createSchema = z
  .object({
    ownerId: idSchema,
    kind: suggestionKindSchema,
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(20_000),
    sourceType: z.string().trim().min(1).max(100),
    sourceRef: z.string().trim().min(1).max(500),
    fingerprint: z.string().trim().min(1).max(500),
    metadata: z.record(z.string(), z.json()).default({}),
    expiresAt: z.date().nullable().optional(),
  })
  .strict();
function safe(row: Row): Suggestion {
  return {
    id: asId<"suggestion">(row.id),
    ownerId: asId<"user">(row.owner_id),
    kind: row.kind,
    status: row.status,
    title: row.title,
    body: row.body,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    metadata: row.metadata,
    revision: row.revision,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createSuggestionRepository(sql: Sql) {
  async function create(
    input: z.input<typeof createSchema>,
  ): Promise<Suggestion> {
    const value = createSchema.parse(input);
    const fingerprint = createHash("sha256").update(value.fingerprint).digest();
    const id = newId<"suggestion">();
    const rows = await sql<Row[]>`
      insert into suggestions (id,owner_id,kind,title,body,source_type,source_ref,fingerprint,metadata,expires_at)
      values (${id},${value.ownerId},${value.kind},${value.title},${value.body},${value.sourceType},${value.sourceRef},${fingerprint},${sql.json(value.metadata as never)},${value.expiresAt ?? null})
      on conflict (owner_id,fingerprint) do update set updated_at=now() returning *
    `;
    if (!rows[0])
      throw new SuggestionError(
        "SUGGESTION_CONFLICT",
        "The suggestion could not be stored.",
      );
    return safe(rows[0]);
  }
  async function list(
    ownerId: Id<"user">,
    status: SuggestionStatus = "open",
    limit = 50,
  ): Promise<Suggestion[]> {
    const bounded = z.number().int().min(1).max(100).parse(limit);
    const rows = await sql<
      Row[]
    >`select * from suggestions where owner_id=${ownerId} and status=${suggestionStatusSchema.parse(status)} and (expires_at is null or expires_at > now()) order by created_at desc,id desc limit ${bounded}`;
    return rows.map(safe);
  }
  async function transition(
    ownerId: Id<"user">,
    id: Id<"suggestion">,
    expectedRevision: number,
    status: Exclude<SuggestionStatus, "open">,
  ): Promise<Suggestion> {
    const revision = z.number().int().positive().parse(expectedRevision);
    const rows = await sql<
      Row[]
    >`update suggestions set status=${suggestionStatusSchema.parse(status)},revision=revision+1,updated_at=now() where owner_id=${ownerId} and id=${id} and revision=${revision} and status='open' returning *`;
    if (!rows[0]) {
      const [existing] = await sql<
        { id: string }[]
      >`select id from suggestions where owner_id=${ownerId} and id=${id}`;
      throw new SuggestionError(
        existing ? "SUGGESTION_CONFLICT" : "SUGGESTION_NOT_FOUND",
        existing
          ? "The suggestion changed since it was read."
          : "The suggestion was not found.",
      );
    }
    return safe(rows[0]);
  }
  return { create, list, transition };
}
export type SuggestionRepository = ReturnType<
  typeof createSuggestionRepository
>;
