import type { Sql } from "postgres";
import { z } from "zod";

import { asId, idSchema, newId, type Id } from "@town/contracts";

import { createRevisionRepository } from "./revision-repository.js";
import { lockKnowledgeResource } from "./resource-lock.js";
import {
  authorTypeSchema,
  citationInputSchema,
  type AuthorType,
  type CitationInput,
  type JsonValue,
  type KnowledgeConflict,
} from "./types.js";

const memoryStatusSchema = z.enum(["active", "stale", "superseded", "retired"]);

const memoryFields = {
  ownerId: idSchema,
  content: z.string().trim().min(1),
  status: memoryStatusSchema,
  confidence: z.number().min(0).max(1).optional(),
  observedAt: z.date(),
  expiresAt: z.date().optional(),
  authorType: authorTypeSchema,
  citations: z.array(citationInputSchema),
};

const memoryCreateSchema = z
  .discriminatedUnion("scope", [
    z
      .object({
        ...memoryFields,
        scope: z.literal("global"),
        routineId: z.undefined().optional(),
      })
      .strict(),
    z
      .object({
        ...memoryFields,
        scope: z.literal("routine"),
        routineId: idSchema,
      })
      .strict(),
  ])
  .refine(
    (value) =>
      value.expiresAt === undefined || value.expiresAt > value.observedAt,
    { message: "Memory expiry must be after observation." },
  );

const memoryUpdateSchema = z.intersection(
  memoryCreateSchema,
  z.object({
    memoryId: idSchema,
    expectedRevision: z.number().int().positive(),
  }),
);

interface MemoryRow {
  id: string;
  owner_id: string;
  scope: "global" | "routine";
  scope_id: string | null;
  content: string;
  status: z.infer<typeof memoryStatusSchema>;
  confidence: number | null;
  observed_at: Date;
  expires_at: Date | null;
  current_revision: number;
  created_at: Date;
  updated_at: Date;
}

export interface Memory {
  id: Id<"memory">;
  ownerId: Id<"user">;
  scope: "global" | "routine";
  routineId: Id<"routine"> | null;
  content: string;
  status: z.infer<typeof memoryStatusSchema>;
  confidence: number | null;
  observedAt: Date;
  expiresAt: Date | null;
  currentRevision: number;
  createdAt: Date;
  updatedAt: Date;
}

export class MemoryError extends Error {
  constructor(
    readonly code:
      "MEMORY_HAS_PENDING_CONFLICT" | "MEMORY_NOT_FOUND" | "MEMORY_NOT_RETIRED",
    message: string,
  ) {
    super(message);
    this.name = "MemoryError";
  }
}

function safeMemory(row: MemoryRow): Memory {
  return {
    id: asId<"memory">(row.id),
    ownerId: asId<"user">(row.owner_id),
    scope: row.scope,
    routineId: row.scope_id === null ? null : asId<"routine">(row.scope_id),
    content: row.content,
    status: row.status,
    confidence: row.confidence,
    observedAt: row.observed_at,
    expiresAt: row.expires_at,
    currentRevision: row.current_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function memorySnapshot(value: z.infer<typeof memoryCreateSchema>) {
  return {
    scope: value.scope,
    routineId: value.scope === "routine" ? value.routineId : null,
    content: value.content,
    status: value.status,
    confidence: value.confidence ?? null,
    observedAt: value.observedAt.toISOString(),
    expiresAt: value.expiresAt?.toISOString() ?? null,
  } satisfies Record<string, JsonValue>;
}

export function createMemoryRepository(sql: Sql) {
  const revisions = createRevisionRepository(sql);

  async function get(
    ownerId: Id<"user">,
    memoryId: Id<"memory">,
  ): Promise<Memory> {
    const values = z
      .object({ ownerId: idSchema, memoryId: idSchema })
      .parse({ ownerId, memoryId });
    const rows = await sql<MemoryRow[]>`
      select * from memories
      where id = ${values.memoryId} and owner_id = ${values.ownerId}
    `;
    const row = rows[0];
    if (row === undefined) {
      throw new MemoryError("MEMORY_NOT_FOUND", "The memory was not found.");
    }
    return safeMemory(row);
  }

  async function create(
    input:
      | {
          ownerId: Id<"user">;
          scope: "global";
          routineId?: never;
          content: string;
          status: Memory["status"];
          confidence?: number;
          observedAt: Date;
          expiresAt?: Date;
          authorType: AuthorType;
          citations: CitationInput[];
        }
      | {
          ownerId: Id<"user">;
          scope: "routine";
          routineId: Id<"routine">;
          content: string;
          status: Memory["status"];
          confidence?: number;
          observedAt: Date;
          expiresAt?: Date;
          authorType: AuthorType;
          citations: CitationInput[];
        },
  ): Promise<Memory> {
    const value = memoryCreateSchema.parse(input);
    const memoryId = newId<"memory">();
    await revisions.createInitial({
      ownerId: asId<"user">(value.ownerId),
      resourceType: "memory",
      resourceId: memoryId,
      authorType: value.authorType,
      snapshot: memorySnapshot(value),
      citations: value.citations,
      applySnapshot: async (transaction) => {
        await transaction`
          insert into memories (
            id, owner_id, scope, scope_id, content, status, confidence,
            observed_at, expires_at, current_revision
          ) values (
            ${memoryId}, ${value.ownerId}, ${value.scope},
            ${value.scope === "routine" ? value.routineId : null},
            ${value.content}, ${value.status}, ${value.confidence ?? null},
            ${value.observedAt}, ${value.expiresAt ?? null}, 1
          )
        `;
      },
    });
    return get(asId<"user">(value.ownerId), memoryId);
  }

  async function update(
    input: Parameters<typeof create>[0] & {
      memoryId: Id<"memory">;
      expectedRevision: number;
    },
  ): Promise<
    | { kind: "applied"; memory: Memory }
    | { kind: "conflict"; conflict: KnowledgeConflict }
  > {
    const value = memoryUpdateSchema.parse(input);
    const memoryId = asId<"memory">(value.memoryId);
    await get(asId<"user">(value.ownerId), memoryId);
    const result = await revisions.append({
      ownerId: asId<"user">(value.ownerId),
      resourceType: "memory",
      resourceId: memoryId,
      expectedRevision: value.expectedRevision,
      authorType: value.authorType,
      snapshot: memorySnapshot(value),
      citations: value.citations,
      applySnapshot: async (transaction, _snapshot, revision) => {
        const rows = await transaction<MemoryRow[]>`
          update memories
          set scope = ${value.scope},
              scope_id = ${value.scope === "routine" ? value.routineId : null},
              content = ${value.content}, status = ${value.status},
              confidence = ${value.confidence ?? null},
              observed_at = ${value.observedAt},
              expires_at = ${value.expiresAt ?? null},
              current_revision = ${revision}, updated_at = now()
          where id = ${memoryId} and owner_id = ${value.ownerId}
            and current_revision = ${value.expectedRevision}
          returning *
        `;
        if (rows.length !== 1) {
          throw new Error("Memory revision state is inconsistent.");
        }
      },
    });
    if (result.kind === "conflict") return result;
    return {
      kind: "applied",
      memory: await get(asId<"user">(value.ownerId), memoryId),
    };
  }

  return {
    create,
    get,
    update,

    async list(
      ownerId: Id<"user">,
      filter?:
        { scope: "global" } | { scope: "routine"; routineId: Id<"routine"> },
    ): Promise<Memory[]> {
      const validOwnerId = asId<"user">(ownerId);
      if (filter?.scope === "routine") {
        const routineId = asId<"routine">(filter.routineId);
        const rows = await sql<MemoryRow[]>`
          select * from memories
          where owner_id = ${validOwnerId} and scope = 'routine'
            and scope_id = ${routineId}
          order by created_at, id
        `;
        return rows.map(safeMemory);
      }
      if (filter?.scope === "global") {
        const rows = await sql<MemoryRow[]>`
          select * from memories
          where owner_id = ${validOwnerId} and scope = 'global'
          order by created_at, id
        `;
        return rows.map(safeMemory);
      }
      const rows = await sql<MemoryRow[]>`
        select * from memories
        where owner_id = ${validOwnerId}
        order by created_at, id
      `;
      return rows.map(safeMemory);
    },

    async retire(input: {
      ownerId: Id<"user">;
      memoryId: Id<"memory">;
      expectedRevision: number;
      authorType: AuthorType;
      citations: CitationInput[];
    }): Promise<Memory> {
      const current = await get(input.ownerId, input.memoryId);
      const result = await update({
        ownerId: input.ownerId,
        memoryId: input.memoryId,
        expectedRevision: input.expectedRevision,
        scope: current.scope,
        ...(current.scope === "routine"
          ? { routineId: current.routineId as Id<"routine"> }
          : {}),
        content: current.content,
        status: "retired",
        ...(current.confidence === null
          ? {}
          : { confidence: current.confidence }),
        observedAt: current.observedAt,
        ...(current.expiresAt === null ? {} : { expiresAt: current.expiresAt }),
        authorType: input.authorType,
        citations: input.citations,
      } as Parameters<typeof update>[0]);
      if (result.kind === "conflict") {
        throw new Error("A user retirement unexpectedly produced a conflict.");
      }
      return result.memory;
    },

    async remove(ownerId: Id<"user">, memoryId: Id<"memory">): Promise<void> {
      await sql.begin(async (transaction) => {
        await lockKnowledgeResource(transaction, ownerId, "memory", memoryId);
        const rows = await transaction<{ status: Memory["status"] }[]>`
          select status from memories
          where id = ${memoryId} and owner_id = ${ownerId}
          for update
        `;
        const memory = rows[0];
        if (memory === undefined) {
          throw new MemoryError(
            "MEMORY_NOT_FOUND",
            "The memory was not found.",
          );
        }
        if (memory.status !== "retired") {
          throw new MemoryError(
            "MEMORY_NOT_RETIRED",
            "Only retired memories can be physically removed.",
          );
        }
        const [pending] = await transaction<{ exists: boolean }[]>`
          select exists(
            select 1 from knowledge_conflicts
            where owner_id = ${ownerId} and resource_type = 'memory'
              and resource_id = ${memoryId} and status = 'pending'
          ) as exists
        `;
        if (pending?.exists === true) {
          throw new MemoryError(
            "MEMORY_HAS_PENDING_CONFLICT",
            "A memory with a pending conflict cannot be removed.",
          );
        }
        await transaction`
          insert into knowledge_resource_tombstones (
            owner_id, resource_type, resource_id
          ) values (${ownerId}, 'memory', ${memoryId})
        `;
        await transaction`
          delete from memories
          where id = ${memoryId} and owner_id = ${ownerId}
        `;
      });
    },
  };
}

export type MemoryRepository = ReturnType<typeof createMemoryRepository>;
