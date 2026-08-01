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

const personCategorySchema = z.enum([
  "uncategorized",
  "coworker",
  "family",
  "personal",
]);
const personStatusSchema = z.enum(["active", "retired"]);
const personFields = {
  ownerId: idSchema,
  displayName: z.string().trim().min(1),
  primaryEmail: z.email().optional(),
  category: personCategorySchema,
  organization: z.string().trim().min(1).optional(),
  role: z.string().trim().min(1).optional(),
  notes: z.string(),
  authorType: authorTypeSchema,
  citations: z.array(citationInputSchema),
};
const personCreateSchema = z.object(personFields).strict();
const personUpdateSchema = z
  .object({
    ...personFields,
    personId: idSchema,
    expectedRevision: z.number().int().positive(),
  })
  .strict();

interface PersonRow {
  id: string;
  owner_id: string;
  display_name: string;
  primary_email: string | null;
  category: z.infer<typeof personCategorySchema>;
  organization: string | null;
  role: string | null;
  notes: string;
  status: z.infer<typeof personStatusSchema>;
  current_revision: number;
  created_at: Date;
  updated_at: Date;
}

export interface Person {
  id: Id<"person">;
  ownerId: Id<"user">;
  displayName: string;
  primaryEmail: string | null;
  category: z.infer<typeof personCategorySchema>;
  organization: string | null;
  role: string | null;
  notes: string;
  status: z.infer<typeof personStatusSchema>;
  currentRevision: number;
  createdAt: Date;
  updatedAt: Date;
}

export class PeopleError extends Error {
  constructor(
    readonly code:
      "PERSON_ALREADY_EXISTS" | "PERSON_NOT_FOUND" | "PROVENANCE_REQUIRED",
    message: string,
  ) {
    super(message);
    this.name = "PeopleError";
  }
}

function safePerson(row: PersonRow): Person {
  return {
    id: asId<"person">(row.id),
    ownerId: asId<"user">(row.owner_id),
    displayName: row.display_name,
    primaryEmail: row.primary_email,
    category: row.category,
    organization: row.organization,
    role: row.role,
    notes: row.notes,
    status: personStatusSchema.parse(row.status),
    currentRevision: row.current_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireProvenance(value: z.infer<typeof personCreateSchema>): void {
  if (value.authorType !== "user" && value.citations.length === 0) {
    throw new PeopleError(
      "PROVENANCE_REQUIRED",
      "Assistant-derived people details require a source citation.",
    );
  }
}

function personSnapshot(
  value: z.infer<typeof personCreateSchema>,
  status: z.infer<typeof personStatusSchema>,
) {
  return {
    displayName: value.displayName,
    primaryEmail: value.primaryEmail ?? null,
    category: value.category,
    organization: value.organization ?? null,
    role: value.role ?? null,
    notes: value.notes,
    status,
  } satisfies Record<string, JsonValue>;
}

export function createPeopleRepository(sql: Sql) {
  const revisions = createRevisionRepository(sql);

  async function get(
    ownerId: Id<"user">,
    personId: Id<"person">,
  ): Promise<Person> {
    const values = z
      .object({ ownerId: idSchema, personId: idSchema })
      .parse({ ownerId, personId });
    const rows = await sql<PersonRow[]>`
      select * from people
      where id = ${values.personId} and owner_id = ${values.ownerId}
    `;
    const row = rows[0];
    if (row === undefined) {
      throw new PeopleError("PERSON_NOT_FOUND", "The person was not found.");
    }
    return safePerson(row);
  }

  async function create(input: {
    ownerId: Id<"user">;
    displayName: string;
    primaryEmail?: string;
    category: Person["category"];
    organization?: string;
    role?: string;
    notes: string;
    authorType: AuthorType;
    citations: CitationInput[];
  }): Promise<Person> {
    const value = personCreateSchema.parse(input);
    requireProvenance(value);
    const personId = newId<"person">();
    try {
      await revisions.createInitial({
        ownerId: asId<"user">(value.ownerId),
        resourceType: "person",
        resourceId: personId,
        authorType: value.authorType,
        snapshot: personSnapshot(value, "active"),
        citations: value.citations,
        applySnapshot: async (transaction) => {
          await transaction`
            insert into people (
              id, owner_id, display_name, primary_email, category,
              organization, role, notes, status, current_revision
            ) values (
              ${personId}, ${value.ownerId}, ${value.displayName},
              ${value.primaryEmail ?? null}, ${value.category},
              ${value.organization ?? null}, ${value.role ?? null},
              ${value.notes}, 'active', 1
            )
          `;
        },
      });
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "constraint_name" in error &&
        error.constraint_name === "people_owner_email_unique"
      ) {
        throw new PeopleError(
          "PERSON_ALREADY_EXISTS",
          "A person with this email already exists for the owner.",
        );
      }
      throw error;
    }
    return get(asId<"user">(value.ownerId), personId);
  }

  async function update(input: {
    ownerId: Id<"user">;
    personId: Id<"person">;
    expectedRevision: number;
    displayName: string;
    primaryEmail?: string;
    category: Person["category"];
    organization?: string;
    role?: string;
    notes: string;
    authorType: AuthorType;
    citations: CitationInput[];
  }): Promise<
    | { kind: "applied"; person: Person }
    | { kind: "conflict"; conflict: KnowledgeConflict }
  > {
    const value = personUpdateSchema.parse(input);
    requireProvenance(value);
    const personId = asId<"person">(value.personId);
    const current = await get(asId<"user">(value.ownerId), personId);
    const result = await revisions.append({
      ownerId: asId<"user">(value.ownerId),
      resourceType: "person",
      resourceId: personId,
      expectedRevision: value.expectedRevision,
      authorType: value.authorType,
      snapshot: personSnapshot(value, current.status),
      citations: value.citations,
      applySnapshot: async (transaction, _snapshot, revision) => {
        const rows = await transaction<PersonRow[]>`
          update people
          set display_name = ${value.displayName},
              primary_email = ${value.primaryEmail ?? null},
              category = ${value.category},
              organization = ${value.organization ?? null},
              role = ${value.role ?? null}, notes = ${value.notes},
              current_revision = ${revision}, updated_at = now()
          where id = ${personId} and owner_id = ${value.ownerId}
            and current_revision = ${value.expectedRevision}
          returning *
        `;
        if (rows.length !== 1) {
          throw new Error("Person revision state is inconsistent.");
        }
      },
    });
    if (result.kind === "conflict") return result;
    return {
      kind: "applied",
      person: await get(asId<"user">(value.ownerId), personId),
    };
  }

  return {
    create,
    get,
    update,

    async list(
      ownerId: Id<"user">,
      filter?: { category?: Person["category"]; includeRetired?: boolean },
    ): Promise<Person[]> {
      const validOwnerId = asId<"user">(ownerId);
      const rows = await sql<PersonRow[]>`
        select * from people
        where owner_id = ${validOwnerId}
          and (${filter?.category ?? null}::text is null or category = ${filter?.category ?? null})
          and (${filter?.includeRetired ?? false} or status = 'active')
        order by created_at, id
      `;
      return rows.map(safePerson);
    },

    async retire(input: {
      ownerId: Id<"user">;
      personId: Id<"person">;
      expectedRevision: number;
      authorType: AuthorType;
      citations: CitationInput[];
    }): Promise<Person> {
      const current = await get(input.ownerId, input.personId);
      const snapshot = {
        displayName: current.displayName,
        primaryEmail: current.primaryEmail,
        category: current.category,
        organization: current.organization,
        role: current.role,
        notes: current.notes,
        status: "retired",
      } satisfies Record<string, JsonValue>;
      const result = await revisions.append({
        ownerId: input.ownerId,
        resourceType: "person",
        resourceId: input.personId,
        expectedRevision: input.expectedRevision,
        authorType: input.authorType,
        snapshot,
        citations: input.citations,
        applySnapshot: async (transaction, _snapshot, revision) => {
          const rows = await transaction<PersonRow[]>`
            update people
            set status = 'retired', current_revision = ${revision},
                updated_at = now()
            where id = ${input.personId} and owner_id = ${input.ownerId}
              and current_revision = ${input.expectedRevision}
            returning *
          `;
          if (rows.length !== 1) {
            throw new Error("Person revision state is inconsistent.");
          }
        },
      });
      if (result.kind === "conflict") {
        throw new Error("A user retirement unexpectedly produced a conflict.");
      }
      return get(input.ownerId, input.personId);
    },
  };
}

export type PeopleRepository = ReturnType<typeof createPeopleRepository>;
