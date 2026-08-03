import { createHash } from "node:crypto";
import type { Sql } from "postgres";
import { z } from "zod";

import {
  asId,
  decodeCursor,
  encodeCursor,
  idSchema,
  newId,
  type Id,
} from "@town/contracts";
import { approvalModeSchema } from "@town/agents";

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
  convertedTaskId: Id<"task"> | null;
}
export interface SuggestionPage {
  items: Suggestion[];
  nextCursor: string | null;
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
  converted_task_id: string | null;
};
const listInput = z
  .object({
    ownerId: idSchema,
    status: suggestionStatusSchema.default("open"),
    limit: z.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).optional(),
  })
  .strict();
const cursorKeySchema = z
  .object({
    status: suggestionStatusSchema,
    createdAt: z.iso.datetime(),
  })
  .strict();
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
    convertedTaskId: row.converted_task_id
      ? asId<"task">(row.converted_task_id)
      : null,
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
  async function listPage(
    input: z.input<typeof listInput>,
  ): Promise<SuggestionPage> {
    const value = listInput.parse(input);
    const decoded =
      value.cursor === undefined ? null : decodeCursor(value.cursor);
    const cursorKey =
      decoded === null ? null : cursorKeySchema.parse(JSON.parse(decoded.key));
    if (cursorKey !== null && cursorKey.status !== value.status)
      throw new z.ZodError([
        {
          code: "custom",
          path: ["cursor"],
          message: "Cursor status does not match the requested status.",
        },
      ]);
    const rows = await sql<Row[]>`
      select * from suggestions
      where owner_id=${value.ownerId}
        and status=${value.status}
        and (expires_at is null or expires_at > now())
        and (
          ${cursorKey === null} or
          created_at < ${cursorKey?.createdAt ?? null}::timestamptz or
          (created_at = ${cursorKey?.createdAt ?? null}::timestamptz and id < ${decoded?.id ?? "00000000-0000-7000-8000-000000000000"}::uuid)
        )
      order by created_at desc,id desc
      limit ${value.limit + 1}
    `;
    const hasMore = rows.length > value.limit;
    const pageRows = hasMore ? rows.slice(0, value.limit) : rows;
    const last = hasMore ? pageRows.at(-1) : undefined;
    return {
      items: pageRows.map(safe),
      nextCursor:
        last === undefined
          ? null
          : encodeCursor({
              version: 1,
              key: JSON.stringify({
                status: value.status,
                createdAt: last.created_at.toISOString(),
              }),
              id: asId(last.id),
            }),
    };
  }
  async function list(
    ownerId: Id<"user">,
    status: SuggestionStatus = "open",
    limit = 50,
  ): Promise<Suggestion[]> {
    return (await listPage({ ownerId, status, limit })).items;
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
  async function convertToTask(input: {
    ownerId: Id<"user">;
    id: Id<"suggestion">;
    expectedRevision: number;
    agentId: Id<"agent">;
    approvalMode: z.infer<typeof approvalModeSchema>;
  }): Promise<{ suggestion: Suggestion; taskId: Id<"task"> }> {
    const revision = z.number().int().positive().parse(input.expectedRevision);
    const mode = approvalModeSchema.parse(input.approvalMode);
    return sql.begin(async (tx) => {
      const [current] = await tx<Row[]>`
        select * from suggestions where owner_id=${input.ownerId} and id=${input.id} for update
      `;
      if (!current)
        throw new SuggestionError(
          "SUGGESTION_NOT_FOUND",
          "The suggestion was not found.",
        );
      if (current.status !== "open" || current.revision !== revision)
        throw new SuggestionError(
          "SUGGESTION_CONFLICT",
          "The suggestion changed since it was read.",
        );
      const threadId = newId<"thread">();
      const taskId = newId<"task">();
      const thread = await tx`
        insert into threads (id,owner_id,agent_id,kind,title,approval_mode,status)
        select ${threadId},${input.ownerId},${input.agentId},'task',${current.title},${mode},'active'
        where exists (select 1 from agents where owner_id=${input.ownerId} and id=${input.agentId} and status='active')
        returning id
      `;
      if (thread.count !== 1)
        throw new SuggestionError(
          "SUGGESTION_CONFLICT",
          "The target Agent is not active.",
        );
      await tx`insert into thread_read_states (owner_id,thread_id,read_through_sequence,force_unread) values (${input.ownerId},${threadId},0,false)`;
      await tx`insert into tasks (id,owner_id,thread_id,title,description,status) values (${taskId},${input.ownerId},${threadId},${current.title},${current.body},'open')`;
      await tx`insert into task_source_refs (id,owner_id,task_id,source_type,source_ref,source_label) values (${newId<"task-source">()},${input.ownerId},${taskId},'external',${`suggestion:${current.id}`},'Suggestion')`;
      const [updated] = await tx<Row[]>`
        update suggestions set status='converted',converted_task_id=${taskId},revision=revision+1,updated_at=now()
        where owner_id=${input.ownerId} and id=${input.id} and status='open' and revision=${revision}
        returning *
      `;
      if (!updated)
        throw new SuggestionError(
          "SUGGESTION_CONFLICT",
          "The suggestion changed during conversion.",
        );
      return { suggestion: safe(updated), taskId: asId<"task">(taskId) };
    });
  }
  return { create, list, listPage, transition, convertToTask };
}
export type SuggestionRepository = ReturnType<
  typeof createSuggestionRepository
>;
