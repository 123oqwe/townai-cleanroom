import { createHash } from "node:crypto";
import type { Sql } from "postgres";

import { asId, newId, type Id } from "@town/contracts";

import { generateSessionToken, hashSessionToken } from "./session-token.js";
import type { SafeSessionDetail } from "./types.js";

// Phase 01A: session lifecycle beyond establish/revoke. Covers listing,
// revoke-all, rotation (atomic, old token invalidated), idle/absolute expiry,
// and throttled last_seen updates. Keeps identity-repository.ts focused.

export interface SessionLifecycleOptions {
  idleTtlMs: number;
  absoluteTtlMs: number;
  authMethod: string;
}

export interface CreateSessionInput {
  userId: Id<"user">;
  authMethod: string;
  now: Date;
  userAgentHash?: Buffer;
  ipMetadataHash?: Buffer;
  sessionFamilyId?: Id<"auth-session-family">;
  rotatedFromSessionId?: Id<"auth-session">;
  idleTtlMs: number;
  absoluteTtlMs: number;
}

export interface CreatedSession {
  token: string;
  sessionId: Id<"auth-session">;
  expiresAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

export class SessionManagementError extends Error {
  constructor(
    readonly code:
      | "SESSION_NOT_FOUND"
      | "SESSION_EXPIRED"
      | "SESSION_REVOKED"
      | "SESSION_ROTATION_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "SessionManagementError";
  }
}

interface SessionDetailRow {
  id: string;
  user_id: string;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  idle_expires_at: Date | null;
  absolute_expires_at: Date | null;
  auth_method: string | null;
  is_current: boolean;
  revoked_at: Date | null;
  user_agent_hash: Buffer | null;
}

function toDetail(row: SessionDetailRow): SafeSessionDetail {
  const deviceLabel =
    row.user_agent_hash === null
      ? null
      : row.user_agent_hash.toString("hex").slice(0, 6);
  return {
    id: asId<"auth-session">(row.id),
    userId: asId<"user">(row.user_id),
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    idleExpiresAt: row.idle_expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
    authMethod: row.auth_method,
    isCurrent: row.is_current,
    revokedAt: row.revoked_at,
    deviceLabel,
  };
}

function hashUa(ua: string | null | undefined): Buffer | null {
  if (ua === null || ua === undefined || ua.length === 0) return null;
  return createHash("sha256").update(ua, "utf8").digest();
}

function hashIp(ip: string | null | undefined): Buffer | null {
  if (ip === null || ip === undefined || ip.length === 0) return null;
  return createHash("sha256").update(`town-ip:${ip}`, "utf8").digest();
}

export function createSessionManager(sql: Sql) {
  return {
    async create(input: CreateSessionInput): Promise<CreatedSession> {
      const token = generateSessionToken();
      const tokenHash = hashSessionToken(token);
      const sessionId = newId<"auth-session">();
      const idleExpiresAt = new Date(input.now.getTime() + input.idleTtlMs);
      const absoluteExpiresAt = new Date(
        input.now.getTime() + input.absoluteTtlMs,
      );
      const expiresAt =
        idleExpiresAt < absoluteExpiresAt ? idleExpiresAt : absoluteExpiresAt;
      await sql`
        insert into auth_sessions (
          id, user_id, token_hash, expires_at, created_at, last_seen_at,
          auth_method, idle_expires_at, absolute_expires_at,
          session_family_id, rotated_from_session_id,
          user_agent_hash, ip_metadata_hash, is_current
        ) values (
          ${sessionId}, ${input.userId}, ${tokenHash}, ${expiresAt},
          ${input.now}, ${input.now}, ${input.authMethod},
          ${idleExpiresAt}, ${absoluteExpiresAt},
          ${input.sessionFamilyId ?? null},
          ${input.rotatedFromSessionId ?? null},
          ${input.userAgentHash ?? null},
          ${input.ipMetadataHash ?? null},
          ${true}
        )
      `;
      return { token, sessionId, expiresAt, idleExpiresAt, absoluteExpiresAt };
    },

    async listActive(
      userId: Id<"user">,
      now: Date,
    ): Promise<SafeSessionDetail[]> {
      const rows = await sql<SessionDetailRow[]>`
        select id, user_id, created_at, last_seen_at, expires_at,
               idle_expires_at, absolute_expires_at, auth_method,
               is_current, revoked_at, user_agent_hash
        from auth_sessions
        where user_id = ${userId}
          and revoked_at is null
          and expires_at > ${now}
          and (idle_expires_at is null or idle_expires_at > ${now})
          and (absolute_expires_at is null or absolute_expires_at > ${now})
        order by created_at desc
      `;
      return rows.map(toDetail);
    },

    async revokeAll(
      userId: Id<"user">,
      now: Date,
      exceptSessionId?: Id<"auth-session">,
    ): Promise<number> {
      const rows = await sql`
        update auth_sessions
        set revoked_at = ${now}, is_current = false
        where user_id = ${userId}
          and revoked_at is null
          ${exceptSessionId !== undefined ? sql`and id <> ${exceptSessionId}` : sql``}
        returning id
      `;
      return rows.count;
    },

    async revoke(
      sessionId: Id<"auth-session">,
      userId: Id<"user">,
      now: Date,
    ): Promise<boolean> {
      const rows = await sql`
        update auth_sessions
        set revoked_at = ${now}, is_current = false
        where id = ${sessionId} and user_id = ${userId} and revoked_at is null
        returning id
      `;
      return rows.count === 1;
    },

    async rotate(
      oldTokenHash: Buffer,
      userId: Id<"user">,
      now: Date,
      options: SessionLifecycleOptions,
      meta?: { userAgent?: string; ip?: string },
    ): Promise<CreatedSession> {
      return sql.begin(async (tx) => {
        const [old] = await tx<
          {
            id: string;
            session_family_id: string | null;
            auth_method: string | null;
          }[]
        >`
          select id, session_family_id, auth_method
          from auth_sessions
          where token_hash = ${oldTokenHash}
            and user_id = ${userId}
            and revoked_at is null
          for update
        `;
        if (old === undefined) {
          throw new SessionManagementError(
            "SESSION_NOT_FOUND",
            "The session was not found.",
          );
        }
        await tx`
          update auth_sessions
          set revoked_at = ${now}, is_current = false
          where id = ${old.id}
        `;
        const familyId =
          old.session_family_id !== null
            ? (old.session_family_id as Id<"auth-session-family">)
            : (old.id as unknown as Id<"auth-session-family">);
        const token = generateSessionToken();
        const newHash = hashSessionToken(token);
        const newSessionId = newId<"auth-session">();
        const idleExpiresAt = new Date(now.getTime() + options.idleTtlMs);
        const absoluteExpiresAt = new Date(
          now.getTime() + options.absoluteTtlMs,
        );
        const expiresAt =
          idleExpiresAt < absoluteExpiresAt ? idleExpiresAt : absoluteExpiresAt;
        await tx`
          insert into auth_sessions (
            id, user_id, token_hash, expires_at, created_at, last_seen_at,
            auth_method, idle_expires_at, absolute_expires_at,
            session_family_id, rotated_from_session_id,
            user_agent_hash, ip_metadata_hash, is_current
          ) values (
            ${newSessionId}, ${userId}, ${newHash}, ${expiresAt},
            ${now}, ${now}, ${options.authMethod},
            ${idleExpiresAt}, ${absoluteExpiresAt},
            ${familyId}, ${old.id},
            ${hashUa(meta?.userAgent)}, ${hashIp(meta?.ip)}, ${true}
          )
        `;
        return {
          token,
          sessionId: newSessionId,
          expiresAt,
          idleExpiresAt,
          absoluteExpiresAt,
        };
      });
    },

    async authenticateHardened(
      tokenHash: Buffer,
      now: Date,
      throttleMs = 60_000,
    ): Promise<{ userId: Id<"user">; sessionId: Id<"auth-session"> } | null> {
      const [row] = await sql<
        { id: string; user_id: string; last_seen_at: Date }[]
      >`
        select id, user_id, last_seen_at
        from auth_sessions
        where token_hash = ${tokenHash}
          and revoked_at is null
          and expires_at > ${now}
          and (idle_expires_at is null or idle_expires_at > ${now})
          and (absolute_expires_at is null or absolute_expires_at > ${now})
        for update
      `;
      if (row === undefined) return null;
      if (now.getTime() - row.last_seen_at.getTime() >= throttleMs) {
        await sql`
          update auth_sessions set last_seen_at = ${now}
          where id = ${row.id}
        `;
      }
      return {
        userId: asId<"user">(row.user_id),
        sessionId: asId<"auth-session">(row.id),
      };
    },
  };
}

export type SessionManager = ReturnType<typeof createSessionManager>;

export { hashUa as hashUserAgent, hashIp as hashIpMetadata };
