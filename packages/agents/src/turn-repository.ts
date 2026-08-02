import { createHash } from "node:crypto";

import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";

import {
  asId,
  decodeCursor,
  encodeCursor,
  idSchema,
  newId,
  type Id,
} from "@town/contracts";

import { AgentError, ThreadError, TurnError } from "./errors.js";
import {
  mentionTargetTypeSchema,
  turnRoleSchema,
  turnSourceTypeSchema,
  type ThreadMention,
  type ThreadTurn,
  type TurnPage,
} from "./types.js";

const mentionInputSchema = z
  .object({
    position: z.number().int().nonnegative(),
    targetType: mentionTargetTypeSchema,
    targetId: idSchema,
    label: z.string().trim().min(1).max(200),
  })
  .strict();
const mentionsSchema = z
  .array(mentionInputSchema)
  .max(100)
  .superRefine((mentions, context) => {
    const positions = new Set<number>();
    for (const mention of mentions) {
      if (positions.has(mention.position)) {
        context.addIssue({
          code: "custom",
          message: "Mention positions must be unique.",
        });
      }
      positions.add(mention.position);
    }
  });
const appendUserSchema = z
  .object({
    ownerId: idSchema,
    threadId: idSchema,
    text: z.string().trim().min(1).max(100_000),
    mentions: mentionsSchema,
  })
  .strict();
const appendRuntimeSchema = z
  .object({
    ownerId: idSchema,
    threadId: idSchema,
    role: z.enum(["assistant", "system"]),
    text: z.string().trim().min(1).max(100_000),
    sourceRef: z.string().trim().min(1).max(500),
    mentions: mentionsSchema,
  })
  .strict();
const listTurnsSchema = z
  .object({
    ownerId: idSchema,
    threadId: idSchema,
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
const turnCursorKeySchema = z
  .object({
    fingerprint: z.string().min(1),
    sequence: z.number().int().positive(),
  })
  .strict();

type MentionInput = z.infer<typeof mentionInputSchema>;

interface TurnRow {
  id: string;
  owner_id: string;
  thread_id: string;
  sequence: number;
  role: z.infer<typeof turnRoleSchema>;
  text: string;
  source_type: z.infer<typeof turnSourceTypeSchema>;
  source_ref: string | null;
  created_at: Date;
}

interface MentionRow {
  id: string;
  turn_id: string;
  position: number;
  target_type: z.infer<typeof mentionTargetTypeSchema>;
  target_id: string;
  label: string;
  created_at: Date;
}

function safeMention(row: MentionRow): ThreadMention {
  return {
    id: asId<"thread-mention">(row.id),
    position: row.position,
    targetType: mentionTargetTypeSchema.parse(row.target_type),
    targetId: asId<"mention-target">(row.target_id),
    label: row.label,
    createdAt: row.created_at,
  };
}

function safeTurn(row: TurnRow, mentions: ThreadMention[]): ThreadTurn {
  return {
    id: asId<"thread-turn">(row.id),
    ownerId: asId<"user">(row.owner_id),
    threadId: asId<"thread">(row.thread_id),
    sequence: row.sequence,
    role: turnRoleSchema.parse(row.role),
    text: row.text,
    sourceType: turnSourceTypeSchema.parse(row.source_type),
    sourceRef: row.source_ref,
    mentions,
    createdAt: row.created_at,
  };
}

function fingerprint(ownerId: string, threadId: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ ownerId, threadId }))
    .digest("base64url");
}

function rejectUnavailableReferences(mentions: MentionInput[]): void {
  if (
    mentions.some(
      ({ targetType }) => targetType === "routine" || targetType === "content",
    )
  ) {
    throw new TurnError(
      "REFERENCE_UNAVAILABLE",
      "The referenced resource type is not installed.",
    );
  }
}

async function assertMentionTarget(
  transaction: Sql | TransactionSql,
  ownerId: Id<"user">,
  mention: MentionInput,
): Promise<void> {
  if (mention.targetType === "agent") {
    const rows = await transaction`
      select id from agents
      where id = ${mention.targetId} and owner_id = ${ownerId}
        and status = 'active'
    `;
    if (rows.count !== 1) {
      throw new AgentError("AGENT_NOT_FOUND", "The Agent was not found.");
    }
    return;
  }
  if (mention.targetType === "thread") {
    const rows = await transaction`
      select id from threads
      where id = ${mention.targetId} and owner_id = ${ownerId}
        and status <> 'deleted'
    `;
    if (rows.count !== 1) {
      throw new ThreadError("THREAD_NOT_FOUND", "The Thread was not found.");
    }
    return;
  }
  if (mention.targetType === "task") {
    const rows = await transaction`
      select id from tasks
      where id = ${mention.targetId} and owner_id = ${ownerId}
        and status <> 'deleted'
    `;
    if (rows.count !== 1) {
      throw new TurnError("TASK_NOT_FOUND", "The Task was not found.");
    }
    return;
  }
  throw new TurnError(
    "REFERENCE_UNAVAILABLE",
    "The referenced resource type is not installed.",
  );
}

export function createTurnRepository(sql: Sql) {
  async function append(input: {
    ownerId: Id<"user">;
    threadId: Id<"thread">;
    role: "user" | "assistant" | "system";
    text: string;
    sourceType: "user" | "runtime";
    sourceRef: string | null;
    mentions: MentionInput[];
  }): Promise<ThreadTurn> {
    rejectUnavailableReferences(input.mentions);
    const turnId = newId<"thread-turn">();

    const result = await sql.begin(async (transaction) => {
      const [thread] = await transaction<{ id: string }[]>`
        select id from threads
        where id = ${input.threadId} and owner_id = ${input.ownerId}
          and status <> 'deleted'
        for update
      `;
      if (thread === undefined) {
        throw new ThreadError("THREAD_NOT_FOUND", "The Thread was not found.");
      }
      for (const mention of input.mentions) {
        await assertMentionTarget(transaction, input.ownerId, mention);
      }

      const [sequenceRow] = await transaction<{ last_turn_sequence: number }[]>`
        update threads
        set last_turn_sequence = last_turn_sequence + 1, updated_at = now()
        where id = ${input.threadId} and owner_id = ${input.ownerId}
          and status <> 'deleted'
        returning last_turn_sequence
      `;
      if (sequenceRow === undefined) {
        throw new ThreadError("THREAD_NOT_FOUND", "The Thread was not found.");
      }
      const [turn] = await transaction<TurnRow[]>`
        insert into thread_turns (
          id, owner_id, thread_id, sequence, role, text, source_type, source_ref
        ) values (
          ${turnId}, ${input.ownerId}, ${input.threadId},
          ${sequenceRow.last_turn_sequence}, ${input.role}, ${input.text},
          ${input.sourceType}, ${input.sourceRef}
        )
        returning *
      `;
      if (turn === undefined) throw new Error("Turn insert returned no row.");

      const mentionRows: MentionRow[] = [];
      for (const mention of input.mentions) {
        const mentionId = newId<"thread-mention">();
        const [row] = await transaction<MentionRow[]>`
          insert into thread_mentions (
            id, owner_id, turn_id, position, target_type, target_id, label
          ) values (
            ${mentionId}, ${input.ownerId}, ${turnId}, ${mention.position},
            ${mention.targetType}, ${mention.targetId}, ${mention.label}
          )
          returning *
        `;
        if (row === undefined)
          throw new Error("Mention insert returned no row.");
        mentionRows.push(row);
      }
      return safeTurn(
        turn,
        mentionRows
          .sort((left, right) => left.position - right.position)
          .map(safeMention),
      );
    });
    return result;
  }

  function appendUser(input: z.input<typeof appendUserSchema>) {
    const value = appendUserSchema.parse(input);
    return append({
      ownerId: asId<"user">(value.ownerId),
      threadId: asId<"thread">(value.threadId),
      role: "user",
      text: value.text,
      sourceType: "user",
      sourceRef: null,
      mentions: value.mentions,
    });
  }

  function appendRuntime(input: z.input<typeof appendRuntimeSchema>) {
    const value = appendRuntimeSchema.parse(input);
    return append({
      ownerId: asId<"user">(value.ownerId),
      threadId: asId<"thread">(value.threadId),
      role: value.role,
      text: value.text,
      sourceType: "runtime",
      sourceRef: value.sourceRef,
      mentions: value.mentions,
    });
  }

  async function list(
    input: z.input<typeof listTurnsSchema>,
  ): Promise<TurnPage> {
    const value = listTurnsSchema.parse(input);
    const ownerId = asId<"user">(value.ownerId);
    const threadId = asId<"thread">(value.threadId);
    const [thread] = await sql<{ id: string }[]>`
      select id from threads
      where id = ${threadId} and owner_id = ${ownerId}
        and status <> 'deleted'
    `;
    if (thread === undefined) {
      throw new ThreadError("THREAD_NOT_FOUND", "The Thread was not found.");
    }

    const queryFingerprint = fingerprint(ownerId, threadId);
    const decoded =
      value.cursor === undefined ? null : decodeCursor(value.cursor);
    const cursorKey =
      decoded === null
        ? null
        : turnCursorKeySchema.parse(JSON.parse(decoded.key));
    if (cursorKey !== null && cursorKey.fingerprint !== queryFingerprint) {
      throw new Error("The Turn cursor belongs to a different Thread.");
    }
    const cursorSequence = cursorKey?.sequence ?? 0;
    const rows = await sql<TurnRow[]>`
      select * from thread_turns
      where owner_id = ${ownerId} and thread_id = ${threadId}
        and sequence > ${cursorSequence}
      order by sequence, id
      limit ${value.limit + 1}
    `;
    const hasMore = rows.length > value.limit;
    const pageRows = hasMore ? rows.slice(0, value.limit) : rows;
    const turnIds = pageRows.map(({ id }) => id);
    const mentionRows =
      turnIds.length === 0
        ? []
        : await sql<MentionRow[]>`
            select * from thread_mentions
            where owner_id = ${ownerId} and turn_id in ${sql(turnIds)}
            order by turn_id, position, id
          `;
    const mentionsByTurn = new Map<string, ThreadMention[]>();
    for (const mention of mentionRows) {
      const mentions = mentionsByTurn.get(mention.turn_id) ?? [];
      mentions.push(safeMention(mention));
      mentionsByTurn.set(mention.turn_id, mentions);
    }
    const items = pageRows.map((row) =>
      safeTurn(row, mentionsByTurn.get(row.id) ?? []),
    );
    const last = hasMore ? pageRows.at(-1) : undefined;
    const nextCursor =
      last === undefined
        ? null
        : encodeCursor({
            version: 1,
            key: JSON.stringify({
              fingerprint: queryFingerprint,
              sequence: last.sequence,
            }),
            id: asId(last.id),
          });
    return { items, nextCursor };
  }

  return { appendRuntime, appendUser, list };
}

export type TurnRepository = ReturnType<typeof createTurnRepository>;
