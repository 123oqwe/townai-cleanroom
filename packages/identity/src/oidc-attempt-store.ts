import { createHash } from "node:crypto";
import type { Sql } from "postgres";

import { newId, type Id } from "@town/contracts";

import type { FlowCipher, FlowEnvelope } from "./session-flow-cipher.js";

// Phase 01A: persistent OIDC attempt store. state is one-time-use; the
// callback consumes it inside a transaction with FOR UPDATE so concurrent
// replay attempts cannot both succeed. The code_verifier AND nonce are
// encrypted together at rest (the nonce_hash column is for lookup only).

export type OidcProvider = "google";
export type OidcFlowType = "login";

export interface OidcAttemptInput {
  provider: OidcProvider;
  flowType: OidcFlowType;
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectPath: string;
  requestMetadataHash?: Buffer;
  ttlMs: number;
}

export interface ConsumedAttempt {
  id: Id<"auth-oidc-attempt">;
  codeVerifier: string;
  nonce: string;
  redirectPath: string;
}

export class OidcAttemptError extends Error {
  constructor(
    readonly code:
      "AUTH_FLOW_EXPIRED" | "AUTH_FLOW_REPLAYED" | "AUTH_STATE_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "OidcAttemptError";
  }
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** JSON payload encrypted inside encrypted_code_verifier. */
interface SealedFlow {
  v: number;
  codeVerifier: string;
  nonce: string;
}

export function createOidcAttemptStore(sql: Sql, cipher: FlowCipher) {
  return {
    /** Create a new attempt; returns the stored id. state/nonce are hashed. */
    async create(input: OidcAttemptInput): Promise<Id<"auth-oidc-attempt">> {
      const id = newId<"auth-oidc-attempt">();
      const now = Date.now();
      const sealed: SealedFlow = {
        v: 1,
        codeVerifier: input.codeVerifier,
        nonce: input.nonce,
      };
      const envelope = cipher.encrypt(JSON.stringify(sealed));
      await sql`
        insert into auth_oidc_attempts (
          id, provider, flow_type, state_hash, nonce_hash,
          encrypted_code_verifier, redirect_path, created_at, expires_at,
          request_metadata_hash
        ) values (
          ${id}, ${input.provider}, ${input.flowType}, ${sha256(input.state)},
          ${sha256(input.nonce)}, ${sql.json(envelope)}, ${input.redirectPath},
          ${new Date(now)}, ${new Date(now + input.ttlMs)},
          ${input.requestMetadataHash ?? null}
        )
      `;
      return id;
    },

    /**
     * Atomically consume an attempt by state. Only the first caller wins;
     * concurrent/replay callers get AUTH_FLOW_REPLAYED. Expired attempts
     * get AUTH_FLOW_EXPIRED. Missing state gets AUTH_STATE_INVALID.
     * Returns the decrypted code_verifier + nonce for ID-token verification.
     */
    async consume(
      state: string,
      now: Date = new Date(),
    ): Promise<ConsumedAttempt> {
      const result = await sql.begin(async (tx) => {
        const [row] = await tx<
          {
            id: string;
            encrypted_code_verifier: FlowEnvelope;
            redirect_path: string;
            expires_at: Date;
            consumed_at: Date | null;
          }[]
        >`
          select id, encrypted_code_verifier, redirect_path,
                 expires_at, consumed_at
          from auth_oidc_attempts
          where state_hash = ${sha256(state)}
          for update
        `;
        if (row === undefined) {
          return { kind: "invalid" as const };
        }
        if (row.consumed_at !== null) {
          return { kind: "replayed" as const };
        }
        if (row.expires_at <= now) {
          await tx`
            update auth_oidc_attempts
            set failure_code = 'AUTH_FLOW_EXPIRED'
            where id = ${row.id}
          `;
          return { kind: "expired" as const };
        }
        await tx`
          update auth_oidc_attempts
          set consumed_at = ${now}
          where id = ${row.id} and consumed_at is null
        `;
        return {
          kind: "ok" as const,
          id: row.id as Id<"auth-oidc-attempt">,
          envelope: row.encrypted_code_verifier,
          redirectPath: row.redirect_path,
        };
      });

      if (result.kind === "invalid")
        throw new OidcAttemptError(
          "AUTH_STATE_INVALID",
          "The auth state was not recognized.",
        );
      if (result.kind === "replayed")
        throw new OidcAttemptError(
          "AUTH_FLOW_REPLAYED",
          "This auth flow has already been used.",
        );
      if (result.kind === "expired")
        throw new OidcAttemptError(
          "AUTH_FLOW_EXPIRED",
          "The auth flow has expired.",
        );

      const sealed = JSON.parse(cipher.decrypt(result.envelope)) as SealedFlow;
      return {
        id: result.id,
        codeVerifier: sealed.codeVerifier,
        nonce: sealed.nonce,
        redirectPath: result.redirectPath,
      };
    },

    /** Mark an attempt as failed with a stable error code (audit). */
    async markFailed(state: string, failureCode: string): Promise<void> {
      await sql`
        update auth_oidc_attempts
        set failure_code = ${failureCode}
        where state_hash = ${sha256(state)} and consumed_at is not null
      `;
    },
  };
}

export type OidcAttemptStore = ReturnType<typeof createOidcAttemptStore>;

/** Hash a nonce for storage/comparison (caller verifies ID token nonce). */
export function hashNonce(nonce: string): Buffer {
  return sha256(nonce);
}
