import type { Sql } from "postgres";
import { z } from "zod";

import { asId, newId, type Id } from "@town/contracts";

import { IdentityRepository } from "./identity-repository.js";
import {
  generateSessionToken,
  hashSessionToken,
  isSessionToken,
} from "./session-token.js";
import type { AuthenticatedIdentity, EstablishedIdentity } from "./types.js";

const identityInputSchema = z
  .object({
    email: z.email(),
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    timezone: z.string().min(1),
  })
  .strict();

export class IdentityError extends Error {
  constructor(
    readonly code: "ACCESS_DENIED" | "UNAUTHENTICATED" | "SESSION_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "IdentityError";
  }
}

export function createIdentityService(
  sql: Sql,
  options: { now?: () => Date; sessionTtlMs?: number } = {},
) {
  const repository = new IdentityRepository(sql);
  const now = options.now ?? (() => new Date());
  const sessionTtlMs = options.sessionTtlMs ?? 30 * 24 * 60 * 60 * 1_000;

  return {
    async establishIdentity(
      input: z.input<typeof identityInputSchema>,
    ): Promise<EstablishedIdentity> {
      const value = identityInputSchema.parse(input);
      const issuedAt = now();
      const token = generateSessionToken();
      const result = await repository.establish(value, {
        userId: newId<"user">(),
        sessionId: newId<"auth-session">(),
        tokenHash: hashSessionToken(token),
        now: issuedAt,
        expiresAt: new Date(issuedAt.getTime() + sessionTtlMs),
      });
      if (result === null) {
        throw new IdentityError(
          "ACCESS_DENIED",
          "This identity is not allowed.",
        );
      }
      return { token, ...result };
    },

    async authenticate(token: string): Promise<AuthenticatedIdentity> {
      if (!isSessionToken(token)) {
        throw new IdentityError("UNAUTHENTICATED", "The session is invalid.");
      }
      const identity = await repository.authenticate(
        hashSessionToken(token),
        now(),
      );
      if (identity === null) {
        throw new IdentityError("UNAUTHENTICATED", "The session is invalid.");
      }
      return identity;
    },

    async revokeSession(sessionId: string, ownerId: string): Promise<void> {
      const revoked = await repository.revoke(
        asId<"auth-session">(sessionId),
        asId<"user">(ownerId),
        now(),
      );
      if (!revoked) {
        throw new IdentityError(
          "SESSION_NOT_FOUND",
          "The session was not found.",
        );
      }
    },
  };
}

export type IdentityService = ReturnType<typeof createIdentityService>;
export type UserId = Id<"user">;
