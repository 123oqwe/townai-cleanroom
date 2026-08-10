import type { Sql } from "postgres";
import { z } from "zod";

import { asId, newId, type Id } from "@town/contracts";

import { IdentityRepository } from "./identity-repository.js";
import { createSessionManager } from "./session-management.js";
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
  options: {
    now?: () => Date;
    sessionTtlMs?: number;
    sessionIdleTtlMs?: number;
  } = {},
) {
  const repository = new IdentityRepository(sql);
  const sessionManager = createSessionManager(sql);
  const now = options.now ?? (() => new Date());
  const sessionTtlMs = options.sessionTtlMs ?? 30 * 24 * 60 * 60 * 1_000;
  const sessionIdleTtlMs =
    options.sessionIdleTtlMs ??
    Number(process.env["AUTH_SESSION_IDLE_TTL_MS"] ?? 15 * 60 * 1_000);

  return {
    async syncAllowlist(emails: string[]): Promise<void> {
      const values = z.array(z.email()).max(1_000).parse(emails);
      await repository.syncAllowlist(values);
    },
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
      // Canonical path: delegate to hardened session authentication.
      // The old IdentityRepository.authenticate path is deprecated.
      const result = await sessionManager.authenticateHardened(
        hashSessionToken(token),
        now(),
        sessionIdleTtlMs,
      );
      if (result === null) {
        throw new IdentityError("UNAUTHENTICATED", "The session is invalid.");
      }
      // Load the user for the authenticated session.
      const user = await repository.findUserById(result.userId);
      if (user === null || user.status !== "active") {
        throw new IdentityError("UNAUTHENTICATED", "The session is invalid.");
      }
      return {
        user,
        session: {
          id: result.sessionId,
          userId: result.userId,
          expiresAt: result.expiresAt,
          createdAt: result.createdAt,
          lastSeenAt: result.lastSeenAt,
        },
      };
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

    /**
     * Dev-only identity establishment. Creates a hardened session with
     * auth_method='dev:email' through the same SessionManager path as OIDC.
     * Must NEVER be available in production.
     */
    async establishDevIdentity(
      input: z.input<typeof identityInputSchema>,
    ): Promise<EstablishedIdentity> {
      const value = identityInputSchema.parse(input);
      const issuedAt = now();
      // Check allowlist first.
      const result = await repository.establishDevUser(value, {
        now: issuedAt,
      });
      if (result === null) {
        throw new IdentityError(
          "ACCESS_DENIED",
          "This identity is not allowed.",
        );
      }
      // Create a hardened session via SessionManager.
      const session = await sessionManager.create({
        userId: result.userId,
        authMethod: "dev:email",
        now: issuedAt,
        idleTtlMs: sessionIdleTtlMs,
        absoluteTtlMs: sessionTtlMs,
      });
      return {
        token: session.token,
        user: result.user,
        session: {
          id: session.sessionId,
          userId: result.userId,
          expiresAt: session.expiresAt,
          createdAt: issuedAt,
          lastSeenAt: issuedAt,
        },
      };
    },
  };
}

export type IdentityService = ReturnType<typeof createIdentityService>;
export type UserId = Id<"user">;
