import type { Sql } from "postgres";

import { asId, newId, type Id } from "@town/contracts";

import type { OidcProvider } from "./oidc-attempt-store.js";

// Phase 01A: verified external identities. An identity is keyed by
// (provider, provider_subject) -- NOT by email alone. Email is only trusted
// after OIDC email_verified === true. Conflicting subjects for the same
// email must NOT silently merge.

export interface VerifiedIdentity {
  id: Id<"auth-identity">;
  userId: Id<"user">;
  provider: OidcProvider;
  providerSubject: string;
  verifiedEmail: string;
  emailVerified: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export interface LinkResult {
  identity: VerifiedIdentity;
  userId: Id<"user">;
  created: boolean;
}

export class VerifiedIdentityError extends Error {
  constructor(
    readonly code: "AUTH_IDENTITY_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "VerifiedIdentityError";
  }
}

interface IdentityRow {
  id: string;
  user_id: string;
  provider: string;
  provider_subject: string;
  verified_email: string;
  email_verified: boolean;
  created_at: Date;
  last_login_at: Date | null;
}

function toIdentity(row: IdentityRow): VerifiedIdentity {
  return {
    id: asId<"auth-identity">(row.id),
    userId: asId<"user">(row.user_id),
    provider: row.provider as OidcProvider,
    providerSubject: row.provider_subject,
    verifiedEmail: row.verified_email,
    emailVerified: row.email_verified,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

export function createVerifiedIdentityRepository(sql: Sql) {
  return {
    /** Find a verified identity by (provider, subject). */
    async findByProviderSubject(
      provider: OidcProvider,
      subject: string,
    ): Promise<VerifiedIdentity | null> {
      const [row] = await sql<IdentityRow[]>`
        select id, user_id, provider, provider_subject,
               verified_email::text, email_verified, created_at, last_login_at
        from auth_identities
        where provider = ${provider} and provider_subject = ${subject}
      `;
      return row === undefined ? null : toIdentity(row);
    },

    /**
     * Link a verified identity to a user.
     * - If (provider, subject) exists, reuse that user.
     * - Else if a user with the verified email exists, link to it (no merge
     *   of differing subjects -- conflict throws AUTH_IDENTITY_CONFLICT).
     * - Else create a new user.
     * Returns the identity + user id + whether a new identity row was created.
     */
    async link(
      input: {
        provider: OidcProvider;
        providerSubject: string;
        verifiedEmail: string;
        existingUserId?: Id<"user">;
        emailVerified: true;
        now: Date;
      },
      options: {
        createUser?: (email: string) => Promise<Id<"user">>;
      } = {},
    ): Promise<LinkResult> {
      return sql.begin(async (tx) => {
        // 1. Existing (provider, subject)?
        const [existing] = await tx<IdentityRow[]>`
          select id, user_id, provider, provider_subject,
                 verified_email::text, email_verified, created_at, last_login_at
          from auth_identities
          where provider = ${input.provider}
            and provider_subject = ${input.providerSubject}
          for update
        `;
        if (existing !== undefined) {
          await tx`
            update auth_identities
            set last_login_at = ${input.now}, verified_email = ${input.verifiedEmail}
            where id = ${existing.id}
          `;
          return {
            identity: toIdentity({ ...existing, last_login_at: input.now }),
            userId: asId<"user">(existing.user_id),
            created: false,
          };
        }

        // 2. Existing user by verified email? Check for subject conflict.
        const [userByEmail] = await tx<{ id: string }[]>`
          select id from users where email = ${input.verifiedEmail} for update
        `;
        if (userByEmail !== undefined) {
          // Ensure no OTHER identity with a different subject owns this email.
          const [conflict] = await tx<{ id: string }[]>`
            select id from auth_identities
            where verified_email = ${input.verifiedEmail}
              and provider = ${input.provider}
              and provider_subject <> ${input.providerSubject}
            for update
          `;
          if (conflict !== undefined) {
            throw new VerifiedIdentityError(
              "AUTH_IDENTITY_CONFLICT",
              "A different verified identity already owns this email.",
            );
          }
          const id = newId<"auth-identity">();
          await tx`
            insert into auth_identities (
              id, user_id, provider, provider_subject, verified_email,
              email_verified, created_at, last_login_at
            ) values (
              ${id}, ${userByEmail.id}, ${input.provider},
              ${input.providerSubject}, ${input.verifiedEmail},
              ${true}, ${input.now}, ${input.now}
            )
          `;
          return {
            identity: {
              id,
              userId: asId<"user">(userByEmail.id),
              provider: input.provider,
              providerSubject: input.providerSubject,
              verifiedEmail: input.verifiedEmail,
              emailVerified: true,
              createdAt: input.now,
              lastLoginAt: input.now,
            },
            userId: asId<"user">(userByEmail.id),
            created: true,
          };
        }

        // 3. Create a new user + identity.
        const userId =
          input.existingUserId ??
          (options.createUser !== undefined
            ? await options.createUser(input.verifiedEmail)
            : newId<"user">());
        await tx`
          insert into users (id, email, timezone, status, created_at, updated_at)
          values (${userId}, ${input.verifiedEmail}, 'UTC', 'active', ${input.now}, ${input.now})
          on conflict (email) do nothing
        `;
        const identityId = newId<"auth-identity">();
        await tx`
          insert into auth_identities (
            id, user_id, provider, provider_subject, verified_email,
            email_verified, created_at, last_login_at
          ) values (
            ${identityId}, ${userId}, ${input.provider},
            ${input.providerSubject}, ${input.verifiedEmail},
            ${true}, ${input.now}, ${input.now}
          )
          on conflict (provider, provider_subject) do nothing
        `;
        return {
          identity: {
            id: identityId,
            userId,
            provider: input.provider,
            providerSubject: input.providerSubject,
            verifiedEmail: input.verifiedEmail,
            emailVerified: true,
            createdAt: input.now,
            lastLoginAt: input.now,
          },
          userId,
          created: true,
        };
      });
    },

    /** Update last_login_at for an existing identity. */
    async touchLastLogin(
      provider: OidcProvider,
      subject: string,
      now: Date,
    ): Promise<void> {
      await sql`
        update auth_identities set last_login_at = ${now}
        where provider = ${provider} and provider_subject = ${subject}
      `;
    },
  };
}

export type VerifiedIdentityRepository = ReturnType<
  typeof createVerifiedIdentityRepository
>;
