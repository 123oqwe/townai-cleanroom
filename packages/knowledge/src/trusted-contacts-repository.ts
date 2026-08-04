import type { Sql } from "postgres";
import { z } from "zod";

import { asId, idSchema, newId, type Id } from "@town/contracts";

export const trustScopeSchema = z.enum(["email", "domain", "phone", "handle"]);
export type TrustScope = z.infer<typeof trustScopeSchema>;

const trustInputSchema = z
  .object({
    ownerId: idSchema,
    scope: trustScopeSchema,
    value: z.string().trim().min(1).max(500),
    label: z.string().trim().max(200).optional(),
  })
  .strict();

interface TrustedContactRow {
  id: string;
  owner_id: string;
  scope: string;
  value: string;
  label: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface TrustedContact {
  id: Id<"trusted-contact">;
  ownerId: Id<"user">;
  scope: TrustScope;
  value: string;
  label: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class TrustedContactError extends Error {
  constructor(
    readonly code:
      | "TRUSTED_CONTACT_NOT_FOUND"
      | "TRUSTED_CONTACT_DUPLICATE"
      | "TRUSTED_CONTACT_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "TrustedContactError";
  }
}

function mapRow(row: TrustedContactRow): TrustedContact {
  return {
    id: asId<"trusted-contact">(row.id),
    ownerId: asId<"user">(row.owner_id),
    scope: row.scope as TrustScope,
    value: row.value,
    label: row.label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Owner-scoped trusted contacts/domains. When a tool targets a trusted
 * recipient, the policy engine can skip approval for safe writes.
 * Real Town.ai allows users to mark specific recipients as trusted
 * so that routine email/calendar actions don't require approval each time.
 */
export function createTrustedContactsRepository(sql: Sql) {
  return {
    async add(input: z.infer<typeof trustInputSchema>): Promise<TrustedContact> {
      const value = trustInputSchema.parse(input);
      const id = newId<"trusted-contact">();
      try {
        const rows = await sql<TrustedContactRow[]>`
          insert into trusted_contacts (id, owner_id, scope, value, label)
          values (${id}, ${value.ownerId}, ${value.scope}, ${value.value.toLowerCase()},
                  ${value.label ?? null})
          returning *`;
        return mapRow(rows[0]!);
      } catch (error: unknown) {
        if (
          typeof error === "object" &&
          error !== null &&
          "constraint_name" in error &&
          (error as { constraint_name: string }).constraint_name ===
            "trusted_contacts_owner_scope_value_unique"
        )
          throw new TrustedContactError(
            "TRUSTED_CONTACT_DUPLICATE",
            "This trusted contact already exists.",
          );
        throw error;
      }
    },

    async list(ownerId: Id<"user">): Promise<TrustedContact[]> {
      const rows = await sql<TrustedContactRow[]>`
        select * from trusted_contacts where owner_id = ${ownerId}
        order by created_at desc`;
      return rows.map(mapRow);
    },

    async remove(ownerId: Id<"user">, id: Id<"trusted-contact">): Promise<void> {
      const rows = await sql`
        delete from trusted_contacts where id = ${id} and owner_id = ${ownerId}`;
      if (rows.count === 0)
        throw new TrustedContactError(
          "TRUSTED_CONTACT_NOT_FOUND",
          "Trusted contact not found.",
        );
    },

    /**
     * Checks whether a target value is trusted for the owner.
     * For domains, checks if the value ends with the domain.
     * For emails, checks exact match or domain match.
     */
    async isTrusted(
      ownerId: Id<"user">,
      scope: TrustScope,
      value: string,
    ): Promise<boolean> {
      const normalized = value.toLowerCase().trim();
      const rows = await sql<{ id: string }[]>`
        select id from trusted_contacts
        where owner_id = ${ownerId} and scope = ${scope}
          and (${scope} = 'domain'
               and ${normalized} like '%' || value
               or ${scope} != 'domain'
               and value = ${normalized})
        limit 1`;
      return rows.length > 0;
    },

    /**
     * Checks if an email address is trusted, either as an exact email
     * match or via its domain.
     */
    async isEmailTrusted(
      ownerId: Id<"user">,
      email: string,
    ): Promise<boolean> {
      const normalized = email.toLowerCase().trim();
      const domain = normalized.split("@")[1] ?? "";
      const rows = await sql<{ id: string }[]>`
        select id from trusted_contacts
        where owner_id = ${ownerId}
          and ((scope = 'email' and value = ${normalized})
               or (scope = 'domain' and ${normalized} like '%@' || value)
               or (scope = 'domain' and ${domain} like '%' || value))
        limit 1`;
      return rows.length > 0;
    },
  };
}

export type TrustedContactsRepository = ReturnType<
  typeof createTrustedContactsRepository
>;
