import type { Sql } from "postgres";
import { z } from "zod";

import { asId, newId, type Id } from "@town/contracts";

import type {
  CredentialCipher,
  CredentialSecret,
} from "./credential-cipher.js";

const providerSchema = z.enum([
  "google",
  "microsoft",
  "slack",
  "notion",
  "dropbox",
]);

export type AccountProvider = z.infer<typeof providerSchema>;

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface SafeConnectedAccount {
  id: Id<"connected-account">;
  ownerId: Id<"user">;
  provider: AccountProvider;
  providerUserId: string;
  email: string;
  isPrimary: boolean;
  isActive: boolean;
  capabilities: Record<string, JsonValue>;
  credentialPresent: boolean;
  tokenExpiresAt: Date | null;
  needsReauth: boolean;
  reauthBlockedByOrgPolicy: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface AccountRow {
  id: string;
  owner_id: string;
  provider: string;
  provider_user_id: string;
  email: string;
  is_primary: boolean;
  is_active: boolean;
  capabilities: Record<string, JsonValue>;
  credential_id: string | null;
  token_expires_at: Date | null;
  needs_reauth: boolean;
  reauth_blocked_by_org_policy: boolean;
  created_at: Date;
  updated_at: Date;
}

export class AccountError extends Error {
  constructor(
    readonly code: "ACCOUNT_ALREADY_EXISTS" | "ACCOUNT_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "AccountError";
  }
}

function safeAccount(row: AccountRow): SafeConnectedAccount {
  return {
    id: asId<"connected-account">(row.id),
    ownerId: asId<"user">(row.owner_id),
    provider: providerSchema.parse(row.provider),
    providerUserId: row.provider_user_id,
    email: row.email,
    isPrimary: row.is_primary,
    isActive: row.is_active,
    capabilities: row.capabilities,
    credentialPresent: row.credential_id !== null,
    tokenExpiresAt: row.token_expires_at,
    needsReauth: row.needs_reauth,
    reauthBlockedByOrgPolicy: row.reauth_blocked_by_org_policy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const accountColumns = `
  id, owner_id, provider, provider_user_id, email::text, is_primary, is_active,
  capabilities, credential_id, token_expires_at, needs_reauth,
  reauth_blocked_by_org_policy, created_at, updated_at
`;

export function createAccountRepository(sql: Sql, cipher: CredentialCipher) {
  return {
    async create(input: {
      ownerId: Id<"user">;
      provider: AccountProvider;
      providerUserId: string;
      email: string;
      isPrimary?: boolean;
      capabilities: Record<string, JsonValue>;
      tokenExpiresAt?: Date;
      credential: CredentialSecret;
    }): Promise<SafeConnectedAccount> {
      const provider = providerSchema.parse(input.provider);
      const accountId = newId<"connected-account">();
      const credentialId = newId<"credential">();
      const envelope = cipher.encrypt(input.credential, {
        credentialId,
        ownerId: input.ownerId,
        accountId,
        provider,
      });

      try {
        return await sql.begin(async (transaction) => {
          await transaction`
            insert into oauth_credentials (id, owner_id, key_version, envelope)
            values (${credentialId}, ${input.ownerId}, ${envelope.keyVersion}, ${transaction.json(envelope)})
          `;
          const rows = await transaction<AccountRow[]>`
            insert into connected_accounts (
              id, owner_id, provider, provider_user_id, email, is_primary,
              capabilities, credential_id, token_expires_at
            ) values (
              ${accountId}, ${input.ownerId}, ${provider}, ${input.providerUserId},
              ${input.email}, ${input.isPrimary ?? false},
              ${transaction.json(input.capabilities)}, ${credentialId},
              ${input.tokenExpiresAt ?? null}
            )
            returning ${transaction.unsafe(accountColumns)}
          `;
          const account = rows[0];
          if (account === undefined)
            throw new Error("Account insert returned no row.");
          return safeAccount(account);
        });
      } catch (error: unknown) {
        if (
          typeof error === "object" &&
          error !== null &&
          "constraint_name" in error &&
          error.constraint_name ===
            "connected_accounts_owner_provider_identity_unique"
        ) {
          throw new AccountError(
            "ACCOUNT_ALREADY_EXISTS",
            "This provider identity is already connected.",
          );
        }
        throw error;
      }
    },

    async listByOwner(ownerId: Id<"user">): Promise<SafeConnectedAccount[]> {
      const rows = await sql<AccountRow[]>`
        select ${sql.unsafe(accountColumns)}
        from connected_accounts
        where owner_id = ${ownerId}
        order by created_at, id
      `;
      return rows.map(safeAccount);
    },

    async rotateCredential(
      ownerId: Id<"user">,
      accountId: Id<"connected-account">,
      credential: CredentialSecret,
    ): Promise<void> {
      await sql.begin(async (transaction) => {
        const [account] = await transaction<
          { credential_id: string | null; provider: string }[]
        >`
          select credential_id, provider
          from connected_accounts
          where id = ${accountId} and owner_id = ${ownerId}
          for update
        `;
        if (
          account?.credential_id === null ||
          account?.credential_id === undefined
        ) {
          throw new AccountError(
            "ACCOUNT_NOT_FOUND",
            "The account was not found.",
          );
        }
        const credentialId = asId<"credential">(account.credential_id);
        const envelope = cipher.encrypt(credential, {
          credentialId,
          ownerId,
          accountId,
          provider: providerSchema.parse(account.provider),
        });
        await transaction`
          update oauth_credentials
          set key_version = ${envelope.keyVersion}, envelope = ${transaction.json(envelope)},
              updated_at = now()
          where id = ${credentialId} and owner_id = ${ownerId}
        `;
      });
    },

    async remove(
      ownerId: Id<"user">,
      accountId: Id<"connected-account">,
    ): Promise<void> {
      await sql.begin(async (transaction) => {
        const [account] = await transaction<{ credential_id: string | null }[]>`
          select credential_id
          from connected_accounts
          where id = ${accountId} and owner_id = ${ownerId}
          for update
        `;
        if (account === undefined) {
          throw new AccountError(
            "ACCOUNT_NOT_FOUND",
            "The account was not found.",
          );
        }
        await transaction`
          delete from connected_accounts where id = ${accountId} and owner_id = ${ownerId}
        `;
        if (account.credential_id !== null) {
          await transaction`
            delete from oauth_credentials
            where id = ${account.credential_id} and owner_id = ${ownerId}
          `;
        }
      });
    },
  };
}

export type AccountRepository = ReturnType<typeof createAccountRepository>;
