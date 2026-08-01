import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";

import { asId, idSchema, type Id } from "@town/contracts";

import { createRevisionRepository } from "./revision-repository.js";
import { snapshotSchema, type KnowledgeConflict } from "./types.js";

const profileSnapshotSchema = z.object({ content: snapshotSchema }).strict();
const memorySnapshotSchema = z
  .object({
    scope: z.enum(["global", "routine"]),
    routineId: idSchema.nullable(),
    content: z.string().trim().min(1),
    status: z.enum(["active", "stale", "superseded", "retired"]),
    confidence: z.number().min(0).max(1).nullable(),
    observedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime().nullable(),
  })
  .strict()
  .refine(
    (value) =>
      (value.scope === "global" && value.routineId === null) ||
      (value.scope === "routine" && value.routineId !== null),
    { message: "The memory scope binding is invalid." },
  );
const personSnapshotSchema = z
  .object({
    displayName: z.string().trim().min(1),
    primaryEmail: z.email().nullable(),
    category: z.enum(["uncategorized", "coworker", "family", "personal"]),
    organization: z.string().trim().min(1).nullable(),
    role: z.string().trim().min(1).nullable(),
    notes: z.string(),
    status: z.enum(["active", "retired"]),
  })
  .strict();
const wikiSnapshotSchema = z
  .object({
    kind: z.enum(["profile", "goal", "project", "page"]),
    slug: z.string().trim().min(1),
    title: z.string().trim().min(1),
    body: z.string(),
    status: z.enum(["active", "retired"]),
  })
  .strict();

async function applyConflictSnapshot(
  transaction: TransactionSql,
  conflict: KnowledgeConflict,
  expectedRevision: number,
  revision: number,
): Promise<void> {
  let changed = 0;
  switch (conflict.resourceType) {
    case "profile": {
      const snapshot = profileSnapshotSchema.parse(conflict.proposedSnapshot);
      const rows = await transaction<{ id: string }[]>`
        update profiles
        set content = ${transaction.json(snapshot.content)},
            current_revision = ${revision}, updated_at = now()
        where id = ${conflict.resourceId} and owner_id = ${conflict.ownerId}
          and current_revision = ${expectedRevision}
        returning id
      `;
      changed = rows.length;
      break;
    }
    case "memory": {
      const snapshot = memorySnapshotSchema.parse(conflict.proposedSnapshot);
      const rows = await transaction<{ id: string }[]>`
        update memories
        set scope = ${snapshot.scope}, scope_id = ${snapshot.routineId},
            content = ${snapshot.content}, status = ${snapshot.status},
            confidence = ${snapshot.confidence},
            observed_at = ${new Date(snapshot.observedAt)},
            expires_at = ${snapshot.expiresAt === null ? null : new Date(snapshot.expiresAt)},
            current_revision = ${revision}, updated_at = now()
        where id = ${conflict.resourceId} and owner_id = ${conflict.ownerId}
          and current_revision = ${expectedRevision}
        returning id
      `;
      changed = rows.length;
      break;
    }
    case "person": {
      const snapshot = personSnapshotSchema.parse(conflict.proposedSnapshot);
      const rows = await transaction<{ id: string }[]>`
        update people
        set display_name = ${snapshot.displayName},
            primary_email = ${snapshot.primaryEmail}, category = ${snapshot.category},
            organization = ${snapshot.organization}, role = ${snapshot.role},
            notes = ${snapshot.notes}, status = ${snapshot.status},
            current_revision = ${revision}, updated_at = now()
        where id = ${conflict.resourceId} and owner_id = ${conflict.ownerId}
          and current_revision = ${expectedRevision}
        returning id
      `;
      changed = rows.length;
      break;
    }
    case "wiki": {
      const snapshot = wikiSnapshotSchema.parse(conflict.proposedSnapshot);
      const rows = await transaction<{ id: string }[]>`
        update wiki_documents
        set kind = ${snapshot.kind}, slug = ${snapshot.slug},
            title = ${snapshot.title}, body = ${snapshot.body},
            status = ${snapshot.status}, current_revision = ${revision},
            updated_at = now()
        where id = ${conflict.resourceId} and owner_id = ${conflict.ownerId}
          and current_revision = ${expectedRevision}
        returning id
      `;
      changed = rows.length;
      break;
    }
  }
  if (changed !== 1) {
    throw new Error("Knowledge conflict resource state is inconsistent.");
  }
}

export function createKnowledgeConflictService(sql: Sql) {
  const revisions = createRevisionRepository(sql);

  return {
    list(ownerId: Id<"user">) {
      return revisions.listConflicts(ownerId);
    },

    async resolve(input: {
      ownerId: Id<"user">;
      conflictId: Id<"knowledge-conflict">;
      expectedRevision: number;
      resolution: "accept" | "reject";
    }) {
      const ownerId = asId<"user">(input.ownerId);
      const conflicts = await revisions.listConflicts(ownerId);
      const conflict = conflicts.find(({ id }) => id === input.conflictId);
      const resolution = {
        ...input,
        ownerId,
      };
      if (conflict === undefined || input.resolution === "reject") {
        return revisions.resolveConflict(resolution);
      }
      return revisions.resolveConflict({
        ...resolution,
        applySnapshot: (transaction, _snapshot, revision) =>
          applyConflictSnapshot(
            transaction,
            conflict,
            input.expectedRevision,
            revision,
          ),
      });
    },
  };
}

export type KnowledgeConflictService = ReturnType<
  typeof createKnowledgeConflictService
>;
