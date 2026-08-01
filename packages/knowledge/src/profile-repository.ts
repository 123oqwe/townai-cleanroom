import type { Sql } from "postgres";
import { z } from "zod";

import { asId, idSchema, newId, type Id } from "@town/contracts";

import { createRevisionRepository } from "./revision-repository.js";
import {
  authorTypeSchema,
  citationInputSchema,
  snapshotSchema,
  type AuthorType,
  type CitationInput,
  type JsonValue,
  type KnowledgeConflict,
  type KnowledgeRevision,
} from "./types.js";

const profileInputSchema = z
  .object({
    ownerId: idSchema,
    content: snapshotSchema,
    authorType: authorTypeSchema,
    citations: z.array(citationInputSchema),
  })
  .strict();

const profileUpdateSchema = profileInputSchema.extend({
  expectedRevision: z.number().int().positive(),
});

interface ProfileRow {
  id: string;
  owner_id: string;
  content: Record<string, JsonValue>;
  current_revision: number;
  created_at: Date;
  updated_at: Date;
}

export interface Profile {
  id: Id<"profile">;
  ownerId: Id<"user">;
  content: Record<string, JsonValue>;
  currentRevision: number;
  createdAt: Date;
  updatedAt: Date;
}

export class ProfileError extends Error {
  constructor(
    readonly code: "PROFILE_ALREADY_EXISTS" | "PROFILE_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "ProfileError";
  }
}

function safeProfile(row: ProfileRow): Profile {
  return {
    id: asId<"profile">(row.id),
    ownerId: asId<"user">(row.owner_id),
    content: row.content,
    currentRevision: row.current_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createProfileRepository(sql: Sql) {
  const revisions = createRevisionRepository(sql);

  async function get(ownerId: Id<"user">): Promise<Profile> {
    const validOwnerId = asId<"user">(ownerId);
    const rows = await sql<ProfileRow[]>`
      select * from profiles where owner_id = ${validOwnerId}
    `;
    const row = rows[0];
    if (row === undefined) {
      throw new ProfileError("PROFILE_NOT_FOUND", "The profile was not found.");
    }
    return safeProfile(row);
  }

  return {
    async create(input: {
      ownerId: Id<"user">;
      content: Record<string, JsonValue>;
      authorType: AuthorType;
      citations: CitationInput[];
    }): Promise<Profile> {
      const value = profileInputSchema.parse(input);
      const profileId = newId<"profile">();
      try {
        await revisions.createInitial({
          ownerId: asId<"user">(value.ownerId),
          resourceType: "profile",
          resourceId: profileId,
          authorType: value.authorType,
          snapshot: { content: value.content },
          citations: value.citations,
          applySnapshot: async (transaction) => {
            await transaction`
              insert into profiles (id, owner_id, content, current_revision)
              values (
                ${profileId}, ${value.ownerId},
                ${transaction.json(value.content)}, 1
              )
            `;
          },
        });
      } catch (error: unknown) {
        if (
          typeof error === "object" &&
          error !== null &&
          "constraint_name" in error &&
          error.constraint_name === "profiles_owner_id_unique"
        ) {
          throw new ProfileError(
            "PROFILE_ALREADY_EXISTS",
            "The owner already has a profile.",
          );
        }
        throw error;
      }
      return get(asId<"user">(value.ownerId));
    },

    get,

    async update(input: {
      ownerId: Id<"user">;
      expectedRevision: number;
      content: Record<string, JsonValue>;
      authorType: AuthorType;
      citations: CitationInput[];
    }): Promise<
      | { kind: "applied"; profile: Profile }
      | { kind: "conflict"; conflict: KnowledgeConflict }
    > {
      const value = profileUpdateSchema.parse(input);
      const profile = await get(asId<"user">(value.ownerId));
      const result = await revisions.append({
        ownerId: asId<"user">(value.ownerId),
        resourceType: "profile",
        resourceId: profile.id,
        expectedRevision: value.expectedRevision,
        authorType: value.authorType,
        snapshot: { content: value.content },
        citations: value.citations,
        applySnapshot: async (transaction, _snapshot, revision) => {
          const rows = await transaction<ProfileRow[]>`
            update profiles
            set content = ${transaction.json(value.content)},
                current_revision = ${revision}, updated_at = now()
            where id = ${profile.id} and owner_id = ${value.ownerId}
              and current_revision = ${value.expectedRevision}
            returning *
          `;
          if (rows.length !== 1) {
            throw new Error("Profile revision state is inconsistent.");
          }
        },
      });
      if (result.kind === "conflict") return result;
      return {
        kind: "applied",
        profile: await get(asId<"user">(value.ownerId)),
      };
    },

    async history(ownerId: Id<"user">): Promise<KnowledgeRevision[]> {
      const profile = await get(ownerId);
      return revisions.list(ownerId, "profile", profile.id);
    },
  };
}

export type ProfileRepository = ReturnType<typeof createProfileRepository>;
