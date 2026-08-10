import type { Sql } from "postgres";

import { asId, newId, type Id } from "@town/contracts";

import type { OidcProvider } from "./oidc-attempt-store.js";

// Phase 01A: verified external identities. An identity is keyed by
// (provider, provider_subject) -- NOT by email alone. Email is only trusted
// after OIDC email_verified === true. Conflicting subjects for the same
// email must NOT silently merge.
//
// Concurrency safety: uses pg_advisory_xact_lock on the normalized email
// so concurrent link() calls for the same email are serialized within the
// transaction. Different emails can proceed in parallel.

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
    readonly code:
      | "AUTH_IDENTITY_CONFLICT"
      | "AUTH_ACCOUNT_DISABLED"
      | "AUTH_IDENTITY_EMAIL_CONFLICT",
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
     *
     * Uses pg_advisory_xact_lock on the normalized email to serialize
     * concurrent link() calls for the same email. After acquiring the lock,
     * re-queries all existing rows (the pre-lock query results may be stale).
     *
     * - Email is normalized (trim + lowercase) before all queries.
     * - User upsert uses ON CONFLICT DO UPDATE ... RETURNING canonical ID.
     * - Identity insert uses ON CONFLICT DO NOTHING; on conflict, re-selects
     *   the canonical identity and verifies it belongs to the same user.
     * - Disabled users are rejected with AUTH_ACCOUNT_DISABLED.
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
      const normalizedEmail = input.verifiedEmail.trim().toLowerCase();

      return sql.begin(async (tx) => {
        // Acquire advisory lock on the normalized email to serialize
        // concurrent link() calls for the same email.
        await tx`
          select pg_advisory_xact_lock(
            hashtextextended(${"auth_identity:" + normalizedEmail}, 0)
          )
        `;

        // After acquiring the lock, re-query everything (pre-lock results
        // may be stale).

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
          // Check if the user is disabled.
          const [userRow] = await tx<{ status: string }[]>`
           select status from users where id = ${existing.user_id}
         `;
          if (userRow?.status === "disabled") {
            throw new VerifiedIdentityError(
              "AUTH_ACCOUNT_DISABLED",
              "This account is disabled.",
            );
          }
          // Check if the email has changed.
          const oldEmail = existing.verified_email;
          if (oldEmail !== normalizedEmail) {
            // Email change: acquire advisory locks on both old and new
            // email in a stable order to prevent deadlocks.
            const lockA =
              oldEmail < normalizedEmail ? oldEmail : normalizedEmail;
            const lockB =
              oldEmail < normalizedEmail ? normalizedEmail : oldEmail;
            await tx`
              select pg_advisory_xact_lock(
                hashtextextended(${"auth_identity:" + lockA}, 0)
              )
            `;
            await tx`
              select pg_advisory_xact_lock(
                hashtextextended(${"auth_identity:" + lockB}, 0)
              )
            `;
            // Check if the new email belongs to a different user.
            const [newEmailUser] = await tx<{ id: string }[]>`
              select id from users
              where email = ${normalizedEmail} and id <> ${existing.user_id}
              for update
            `;
            if (newEmailUser !== undefined) {
              throw new VerifiedIdentityError(
                "AUTH_IDENTITY_EMAIL_CONFLICT",
                "The new email is already associated with a different user.",
              );
            }
            // Check if another identity already has the new email.
            const [newEmailIdentity] = await tx<{ id: string }[]>`
              select id from auth_identities
              where verified_email = ${normalizedEmail}
                and id <> ${existing.id}
              for update
            `;
            if (newEmailIdentity !== undefined) {
              throw new VerifiedIdentityError(
                "AUTH_IDENTITY_EMAIL_CONFLICT",
                "The new email is already associated with a different identity.",
              );
            }
          }
          // Update last_login_at and email (if changed).
          await tx`
            update auth_identities
            set last_login_at = ${input.now}, verified_email = ${normalizedEmail}
            where id = ${existing.id}
          `;
          return {
            identity: toIdentity({
              ...existing,
              last_login_at: input.now,
              verified_email: normalizedEmail,
            }),
            userId: asId<"user">(existing.user_id),
            created: false,
          };
        }

        // 2. Existing user by normalized email?
        const [userByEmail] = await tx<{ id: string; status: string }[]>`
          select id, status from users
          where email = ${normalizedEmail}
          for update
        `;
        if (userByEmail !== undefined) {
          if (userByEmail.status === "disabled") {
            throw new VerifiedIdentityError(
              "AUTH_ACCOUNT_DISABLED",
              "This account is disabled.",
            );
          }
          // Check for subject conflict.
          const [conflict] = await tx<{ id: string }[]>`
            select id from auth_identities
            where verified_email = ${normalizedEmail}
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
          // Insert identity linked to existing user.
          const identityId = newId<"auth-identity">();
          const [insertedIdentity] = await tx<IdentityRow[]>`
            insert into auth_identities (
              id, user_id, provider, provider_subject, verified_email,
              email_verified, created_at, last_login_at
            ) values (
              ${identityId}, ${userByEmail.id}, ${input.provider},
              ${input.providerSubject}, ${normalizedEmail},
              ${true}, ${input.now}, ${input.now}
            )
            on conflict (provider, provider_subject) do nothing
            returning id, user_id, provider, provider_subject,
                      verified_email::text, email_verified, created_at, last_login_at
          `;
          if (insertedIdentity !== undefined) {
            return {
              identity: toIdentity(insertedIdentity),
              userId: asId<"user">(userByEmail.id),
              created: true,
            };
          }
          // Conflict: another concurrent insert won. Re-select canonical.
          const [canonical] = await tx<IdentityRow[]>`
            select id, user_id, provider, provider_subject,
                   verified_email::text, email_verified, created_at, last_login_at
            from auth_identities
            where provider = ${input.provider}
              and provider_subject = ${input.providerSubject}
            for update
          `;
          if (canonical !== undefined && canonical.user_id === userByEmail.id) {
            return {
              identity: toIdentity(canonical),
              userId: asId<"user">(canonical.user_id),
              created: false,
            };
          }
          throw new VerifiedIdentityError(
            "AUTH_IDENTITY_CONFLICT",
            "A different verified identity already owns this email.",
          );
        }

        // 3. Create a new user + identity.
        const candidateUserId =
          input.existingUserId ??
          (options.createUser !== undefined
            ? await options.createUser(normalizedEmail)
            : newId<"user">());
        const [userRow] = await tx<{ id: string; status: string }[]>`
          insert into users (id, email, timezone, status, created_at, updated_at)
          values (${candidateUserId}, ${normalizedEmail}, 'UTC', 'active', ${input.now}, ${input.now})
          on conflict (email) do update set updated_at = excluded.updated_at
          returning id, status
        `;
        if (userRow === undefined) {
          throw new Error("User upsert returned no row.");
        }
        if (userRow.status === "disabled") {
          throw new VerifiedIdentityError(
            "AUTH_ACCOUNT_DISABLED",
            "This account is disabled.",
          );
        }
        const canonicalUserId = asId<"user">(userRow.id);
        const identityId = newId<"auth-identity">();
        const [identityRow] = await tx<IdentityRow[]>`
          insert into auth_identities (
            id, user_id, provider, provider_subject, verified_email,
            email_verified, created_at, last_login_at
          ) values (
            ${identityId}, ${canonicalUserId}, ${input.provider},
            ${input.providerSubject}, ${normalizedEmail},
            ${true}, ${input.now}, ${input.now}
          )
          on conflict (provider, provider_subject) do nothing
          returning id, user_id, provider, provider_subject,
                    verified_email::text, email_verified, created_at, last_login_at
        `;
        if (identityRow !== undefined) {
          return {
            identity: toIdentity(identityRow),
            userId: canonicalUserId,
            created: true,
          };
        }
        // Conflict: re-select canonical identity and verify ownership.
        const [canonical] = await tx<IdentityRow[]>`
          select id, user_id, provider, provider_subject,
                 verified_email::text, email_verified, created_at, last_login_at
          from auth_identities
          where provider = ${input.provider}
            and provider_subject = ${input.providerSubject}
          for update
        `;
        if (canonical !== undefined && canonical.user_id === canonicalUserId) {
          return {
            identity: toIdentity(canonical),
            userId: canonicalUserId,
            created: false,
          };
        }
        throw new VerifiedIdentityError(
          "AUTH_IDENTITY_CONFLICT",
          "A different verified identity already owns this email.",
        );
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
