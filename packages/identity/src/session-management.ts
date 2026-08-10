import { createHash } from "node:crypto";
import type { Sql } from "postgres";

import { asId, newId, type Id } from "@town/contracts";

import { generateSessionToken, hashSessionToken } from "./session-token.js";
import type { SafeSessionDetail } from "./types.js";

// Phase 01A: session lifecycle beyond establish/revoke. Covers listing,
// revoke-all, rotation (atomic, old token invalidated), idle/absolute expiry,
// and throttled last_seen updates. Keeps identity-repository.ts focused.
//
// All time-sensitive operations use PostgreSQL clock_timestamp() as the
// authoritative time source. No method in the production path accepts a
// Node-side `now: Date` parameter for time-critical decisions.

export interface SessionLifecycleOptions {
  idleTtlMs: number;
  absoluteTtlMs: number;
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

export interface CreatedSessionWithDbClock extends CreatedSession {
  cookieMaxAgeSeconds: number;
  createdAt: Date;
}

export class SessionManagementError extends Error {
  constructor(
    readonly code:
      | "SESSION_NOT_FOUND"
      | "SESSION_EXPIRED"
      | "SESSION_REVOKED"
      | "SESSION_ROTATION_CONFLICT"
      | "SESSION_AUTH_METHOD_INVALID",
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

function toDetail(
  row: SessionDetailRow,
  currentSessionId?: string,
): SafeSessionDetail {
  const deviceLabel =
    row.user_agent_hash === null
      ? null
      : row.user_agent_hash.toString("hex").slice(0, 6);
  // Dynamic isCurrent: compute from the authenticated session context,
  // do NOT trust the database is_current column.
  const isCurrent =
    currentSessionId !== undefined && row.id === currentSessionId;
  return {
    id: asId<"auth-session">(row.id),
    userId: asId<"user">(row.user_id),
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    idleExpiresAt: row.idle_expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
    authMethod: row.auth_method,
    isCurrent,
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
    /**
     * TEST-ONLY: Create a session using Node-side time.
     * Production code MUST use createWithDbClock instead, which uses
     * PostgreSQL clock_timestamp() as the authoritative time source.
     * This method exists for tests that need deterministic Node-side time.
     */
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

    /**
     * Create a session using PostgreSQL clock_timestamp() as the authoritative
     * time source. All timestamps (created_at, last_seen_at, idle_expires_at,
     * absolute_expires_at, expires_at) are computed from a single DB clock
     * read, returned via RETURNING.
     */
    async createWithDbClock(input: {
      userId: Id<"user">;
      authMethod: string;
      idleTtlMs: number;
      absoluteTtlMs: number;
    }): Promise<CreatedSessionWithDbClock> {
      const token = generateSessionToken();
      const tokenHash = hashSessionToken(token);
      const sessionId = newId<"auth-session">();
      const [row] = await sql<
        {
          created_at: Date;
          expires_at: Date;
          idle_expires_at: Date;
          absolute_expires_at: Date;
          server_now: Date;
        }[]
      >`
        with clock as (select clock_timestamp() as now)
        insert into auth_sessions (
          id, user_id, token_hash, expires_at, created_at, last_seen_at,
          auth_method, idle_expires_at, absolute_expires_at,
          session_family_id, rotated_from_session_id,
          user_agent_hash, ip_metadata_hash, is_current
        )
        select
          ${sessionId}, ${input.userId}, ${tokenHash},
          least(
            clock.now + make_interval(secs => ${input.idleTtlMs} / 1000.0),
            clock.now + make_interval(secs => ${input.absoluteTtlMs} / 1000.0)
          ),
          clock.now, clock.now, ${input.authMethod},
          clock.now + make_interval(secs => ${input.idleTtlMs} / 1000.0),
          clock.now + make_interval(secs => ${input.absoluteTtlMs} / 1000.0),
          null, null, null, null, true
        from clock
        returning created_at, expires_at, idle_expires_at,
                 absolute_expires_at, (select now from clock) as server_now
      `;
      if (row === undefined) {
        throw new Error("Session insert returned no row.");
      }
      // Ensure Date fields are actual Date objects (postgres may return strings).
      const createdAt =
        row.created_at instanceof Date
          ? row.created_at
          : new Date(row.created_at);
      const expiresAt =
        row.expires_at instanceof Date
          ? row.expires_at
          : new Date(row.expires_at);
      const idleExpiresAt =
        row.idle_expires_at instanceof Date
          ? row.idle_expires_at
          : new Date(row.idle_expires_at);
      const absoluteExpiresAt =
        row.absolute_expires_at instanceof Date
          ? row.absolute_expires_at
          : new Date(row.absolute_expires_at);
      const serverNow =
        row.server_now instanceof Date
          ? row.server_now
          : new Date(row.server_now);
      const cookieMaxAgeSeconds = Math.floor(
        (absoluteExpiresAt.getTime() - serverNow.getTime()) / 1000,
      );
      return {
        token,
        sessionId,
        expiresAt,
        idleExpiresAt,
        absoluteExpiresAt,
        cookieMaxAgeSeconds,
        createdAt,
      };
    },

    /**
     * List active sessions using DB clock_timestamp().
     * isCurrent is computed dynamically from the currentSessionId parameter.
     */
    async listActive(
      userId: Id<"user">,
      currentSessionId?: Id<"auth-session">,
    ): Promise<SafeSessionDetail[]> {
      const rows = await sql<SessionDetailRow[]>`
       select id, user_id, created_at, last_seen_at, expires_at,
              idle_expires_at, absolute_expires_at, auth_method,
              is_current, revoked_at, user_agent_hash
       from auth_sessions, (select clock_timestamp() as db_now) as c
       where user_id = ${userId}
         and revoked_at is null
         and expires_at > c.db_now
         and (idle_expires_at is null or idle_expires_at > c.db_now)
         and (absolute_expires_at is null or absolute_expires_at > c.db_now)
       order by created_at desc
     `;
      return rows.map((r) =>
        toDetail(r, currentSessionId as string | undefined),
      );
    },

    /**
     * Revoke all sessions except the specified one, using DB clock_timestamp().
     */
    async revokeAll(
      userId: Id<"user">,
      exceptSessionId?: Id<"auth-session">,
    ): Promise<number> {
      const rows = await sql`
        update auth_sessions
        set revoked_at = clock_timestamp(), is_current = false
        where user_id = ${userId}
          and revoked_at is null
          ${exceptSessionId !== undefined ? sql`and id <> ${exceptSessionId}` : sql``}
        returning id
      `;
      return rows.count;
    },

    /**
     * Revoke ALL sessions for a user, INCLUDING the current one.
     * Uses DB clock_timestamp().
     */
    async revokeAllIncludingCurrent(userId: Id<"user">): Promise<number> {
      const rows = await sql`
        update auth_sessions
        set revoked_at = clock_timestamp(), is_current = false
        where user_id = ${userId}
          and revoked_at is null
        returning id
      `;
      return rows.count;
    },

    /**
     * Revoke a specific session using DB clock_timestamp().
     */
    async revoke(
      sessionId: Id<"auth-session">,
      userId: Id<"user">,
    ): Promise<boolean> {
      const rows = await sql`
        update auth_sessions
        set revoked_at = clock_timestamp(), is_current = false
        where id = ${sessionId} and user_id = ${userId} and revoked_at is null
        returning id
      `;
      return rows.count === 1;
    },

    /**
     * Rotate by session ID (from auth context). Does NOT accept raw tokens.
     * Uses DB clock_timestamp() as the authoritative time source.
     * Re-validates session expiry and user status before rotating.
     * Inherits old.auth_method — rejects if auth_method is NULL.
     */
    async rotateById(
      sessionId: Id<"auth-session">,
      userId: Id<"user">,
      options: SessionLifecycleOptions,
      meta?: { userAgent?: string; ip?: string },
    ): Promise<CreatedSessionWithDbClock> {
      return sql.begin(async (tx) => {
        // Use a CTE to get clock_timestamp() once for the entire transaction.
        const [old] = await tx<
          {
            id: string;
            session_family_id: string | null;
            auth_method: string | null;
            absolute_expires_at: Date | null;
            idle_expires_at: Date | null;
            expires_at: Date;
            db_now: Date;
            user_status: string;
          }[]
        >`
          select s.id, s.session_family_id, s.auth_method,
                 s.absolute_expires_at, s.idle_expires_at, s.expires_at,
                 clock_timestamp()::timestamptz as db_now, u.status as user_status
          from auth_sessions s
          join users u on u.id = s.user_id
          where s.id = ${sessionId}
            and s.user_id = ${userId}
            and s.revoked_at is null
          for update of s
        `;
        if (old === undefined) {
          throw new SessionManagementError(
            "SESSION_NOT_FOUND",
            "The session was not found.",
          );
        }
        // Ensure db_now is a Date (postgres may return string).
        const dbNow =
          old.db_now instanceof Date ? old.db_now : new Date(old.db_now);
        // Re-validate session expiry using DB clock.
        // Ensure all Date fields from DB are actual Date objects.
        const oldExpiresAt =
          old.expires_at instanceof Date
            ? old.expires_at
            : new Date(old.expires_at);
        const oldIdleExpiresAt =
          old.idle_expires_at === null
            ? null
            : old.idle_expires_at instanceof Date
              ? old.idle_expires_at
              : new Date(old.idle_expires_at);
        const oldAbsoluteExpiresAt =
          old.absolute_expires_at === null
            ? null
            : old.absolute_expires_at instanceof Date
              ? old.absolute_expires_at
              : new Date(old.absolute_expires_at);
        // Re-validate session expiry using DB clock.
        if (oldExpiresAt <= dbNow) {
          throw new SessionManagementError(
            "SESSION_EXPIRED",
            "The session has expired.",
          );
        }
        if (oldIdleExpiresAt !== null && oldIdleExpiresAt <= dbNow) {
          throw new SessionManagementError(
            "SESSION_EXPIRED",
            "The session has expired.",
          );
        }
        if (oldAbsoluteExpiresAt !== null && oldAbsoluteExpiresAt <= dbNow) {
          throw new SessionManagementError(
            "SESSION_EXPIRED",
            "The session has expired.",
          );
        }
        // auth_method must NOT be NULL.
        if (old.auth_method === null) {
          throw new SessionManagementError(
            "SESSION_AUTH_METHOD_INVALID",
            "The session has an invalid auth method.",
          );
        }
        // User must be active.
        if (old.user_status !== "active") {
          throw new SessionManagementError(
            "SESSION_NOT_FOUND",
            "The session was not found.",
          );
        }

        await tx`
          update auth_sessions
          set revoked_at = ${dbNow}, is_current = false
          where id = ${old.id}
        `;
        const familyId =
          old.session_family_id !== null
            ? (old.session_family_id as Id<"auth-session-family">)
            : (old.id as unknown as Id<"auth-session-family">);
        const token = generateSessionToken();
        const newHash = hashSessionToken(token);
        const newSessionId = newId<"auth-session">();
        const idleExpiresAt = new Date(dbNow.getTime() + options.idleTtlMs);
        // Preserve the original absolute expiry — rotation must NOT extend
        // the session's absolute lifetime.
        const absoluteExpiresAt =
          oldAbsoluteExpiresAt !== null
            ? oldAbsoluteExpiresAt
            : new Date(dbNow.getTime() + options.absoluteTtlMs);
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
            ${dbNow}, ${dbNow}, ${old.auth_method},
            ${idleExpiresAt}, ${absoluteExpiresAt},
            ${familyId}, ${old.id},
            ${hashUa(meta?.userAgent)}, ${hashIp(meta?.ip)}, ${true}
          )
        `;
        const cookieMaxAgeSeconds = Math.floor(
          (absoluteExpiresAt.getTime() - dbNow.getTime()) / 1000,
        );
        return {
          token,
          sessionId: newSessionId,
          expiresAt,
          idleExpiresAt,
          absoluteExpiresAt,
          cookieMaxAgeSeconds,
          createdAt: dbNow,
        };
      });
    },

    /**
     * Canonical hardened session authentication.
     *
     * Uses a CTE to get clock_timestamp() once, then uses that single
     * timestamp for all comparisons and updates in the same statement.
     *
     * Implements sliding idle expiration: when the throttle window has
     * elapsed, idle_expires_at is extended to min(db_now + idleTtlMs,
     * absolute_expires_at), capped by the absolute expiry.
     * last_seen_at and expires_at are updated ONLY when the throttle
     * window has elapsed; below-threshold requests leave them unchanged.
     */
    async authenticateHardened(
      tokenHash: Buffer,
      idleTtlMs: number,
      throttleMs = 60_000,
    ): Promise<{
      userId: Id<"user">;
      sessionId: Id<"auth-session">;
      expiresAt: Date;
      idleExpiresAt: Date | null;
      absoluteExpiresAt: Date | null;
      lastSeenAt: Date;
      createdAt: Date;
    } | null> {
      const [row] = await sql<
        {
          id: string;
          user_id: string;
          last_seen_at: Date;
          idle_expires_at: Date | null;
          absolute_expires_at: Date | null;
          expires_at: Date;
          created_at: Date;
        }[]
      >`
        with auth_clock as (
          select clock_timestamp() as now
        )
        update auth_sessions as s
        set last_seen_at = case
              when extract(epoch from (auth_clock.now - s.last_seen_at)) * 1000 >= ${throttleMs}
              then auth_clock.now
              else s.last_seen_at
            end,
            idle_expires_at = case
              when s.idle_expires_at is not null
                and extract(epoch from (auth_clock.now - s.last_seen_at)) * 1000 >= ${throttleMs}
              then least(
                auth_clock.now + make_interval(secs => ${idleTtlMs} / 1000.0),
                s.absolute_expires_at
              )
              else s.idle_expires_at
            end,
            expires_at = case
              when s.idle_expires_at is not null
                and extract(epoch from (auth_clock.now - s.last_seen_at)) * 1000 >= ${throttleMs}
              then least(
                auth_clock.now + make_interval(secs => ${idleTtlMs} / 1000.0),
                s.absolute_expires_at
              )
              else s.expires_at
            end
        from users as u, auth_clock
        where s.token_hash = ${tokenHash}
          and s.user_id = u.id
          and s.revoked_at is null
          and s.expires_at > auth_clock.now
          and (s.idle_expires_at is null or s.idle_expires_at > auth_clock.now)
          and (s.absolute_expires_at is null or s.absolute_expires_at > auth_clock.now)
          and u.status = 'active'
        returning s.id, s.user_id, s.last_seen_at,
                  s.idle_expires_at, s.absolute_expires_at, s.expires_at,
                  s.created_at
      `;
      if (row === undefined) return null;
      return {
        userId: asId<"user">(row.user_id),
        sessionId: asId<"auth-session">(row.id),
        expiresAt: row.expires_at,
        idleExpiresAt: row.idle_expires_at,
        absoluteExpiresAt: row.absolute_expires_at,
        lastSeenAt: row.last_seen_at,
        createdAt: row.created_at,
      };
    },
  };
}

export type SessionManager = ReturnType<typeof createSessionManager>;

export { hashUa as hashUserAgent, hashIp as hashIpMetadata };
