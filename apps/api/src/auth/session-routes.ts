import { z } from "zod";
import type { Hono } from "hono";

import type { Sql } from "postgres";

import type { AuthVariables } from "../lib/auth.js";
import { createSessionManager } from "@town/identity";

// Phase 01A: authenticated session-management routes. All require a valid
// session (the existing auth middleware populates context.get("identity")).
// All time-sensitive operations use PostgreSQL clock_timestamp().

export interface SessionRouteDependencies {
  sql: Sql;
  idleTtlMs: number;
  absoluteTtlMs: number;
}

export function registerSessionRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  deps: SessionRouteDependencies,
): void {
  const manager = createSessionManager(deps.sql);

  // GET /v1/me/sessions -- list active sessions for the current user.
  // isCurrent is computed dynamically from the authenticated session context.
  app.get("/v1/me/sessions", async (context) => {
    const identity = context.get("identity");
    const sessions = await manager.listActive(
      identity.user.id,
      new Date(),
      identity.session.id,
    );
    return context.json({ sessions });
  });

  // DELETE /v1/me/sessions/:sessionId -- revoke a specific session.
  // Validates sessionId is a UUID before using it.
  app.delete("/v1/me/sessions/:sessionId", async (context) => {
    const identity = context.get("identity");
    const rawSessionId = context.req.param("sessionId");
    const parsed = z.uuid().safeParse(rawSessionId);
    if (!parsed.success) {
      return context.json({ code: "INVALID_SESSION_ID" }, 400);
    }
    const revoked = await manager.revoke(
      parsed.data as never,
      identity.user.id,
    );
    if (!revoked) {
      return context.json({ code: "SESSION_NOT_FOUND" }, 404);
    }
    // Check if the revoked session was the current one.
    const revokedCurrent = parsed.data === identity.session.id;
    return context.json({ revoked: true, revokedCurrent }, 200);
  });

  // DELETE /v1/me/sessions -- revoke all OTHER sessions (logout other devices).
  // The current session is preserved.
  app.delete("/v1/me/sessions", async (context) => {
    const identity = context.get("identity");
    const count = await manager.revokeAll(
      identity.user.id,
      identity.session.id,
    );
    return context.json({ revoked: count });
  });

  // DELETE /v1/me/sessions/all -- revoke ALL sessions INCLUDING the current
  // one (logout all devices).
  app.delete("/v1/me/sessions/all", async (context) => {
    const identity = context.get("identity");
    const count = await manager.revokeAllIncludingCurrent(identity.user.id);
    return context.json({ revoked: count });
  });

  // POST /v1/me/session/rotate -- rotate the current session.
  // Uses the session ID from the auth context; no raw token in headers.
  // Rotation uses DB clock_timestamp() and inherits old.auth_method.
  app.post("/v1/me/session/rotate", async (context) => {
    const identity = context.get("identity");
    const rotated = await manager.rotateById(
      identity.session.id,
      identity.user.id,
      {
        idleTtlMs: deps.idleTtlMs,
        absoluteTtlMs: deps.absoluteTtlMs,
      },
    );
    return context.json({
      token: rotated.token,
      sessionId: rotated.sessionId,
      expiresAt: rotated.expiresAt,
      idleExpiresAt: rotated.idleExpiresAt,
      absoluteExpiresAt: rotated.absoluteExpiresAt,
      cookieMaxAgeSeconds: rotated.cookieMaxAgeSeconds,
    });
  });
}
