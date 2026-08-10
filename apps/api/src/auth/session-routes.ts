import type { Hono } from "hono";

import type { Sql } from "postgres";

import type { AuthVariables } from "../lib/auth.js";
import { createSessionManager } from "@town/identity";

// Phase 01A: authenticated session-management routes. All require a valid
// session (the existing auth middleware populates context.get("identity")).

export interface SessionRouteDependencies {
  sql: Sql;
  idleTtlMs: number;
  absoluteTtlMs: number;
  authMethod: string;
}

export function registerSessionRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  deps: SessionRouteDependencies,
): void {
  const manager = createSessionManager(deps.sql);

  // GET /v1/me/sessions -- list active sessions for the current user.
  app.get("/v1/me/sessions", async (context) => {
    const identity = context.get("identity");
    const sessions = await manager.listActive(identity.user.id, new Date());
    return context.json({ sessions });
  });

  // DELETE /v1/me/sessions/:sessionId -- revoke a specific session.
  app.delete("/v1/me/sessions/:sessionId", async (context) => {
    const identity = context.get("identity");
    const sessionId = context.req.param("sessionId");
    const revoked = await manager.revoke(
      sessionId as never,
      identity.user.id,
      new Date(),
    );
    if (!revoked) {
      return context.json({ code: "SESSION_NOT_FOUND" }, 404);
    }
    return context.body(null, 204);
  });

  // DELETE /v1/me/sessions -- revoke all sessions (logout-all).
  app.delete("/v1/me/sessions", async (context) => {
    const identity = context.get("identity");
    const count = await manager.revokeAll(
      identity.user.id,
      new Date(),
      identity.session.id,
    );
    return context.json({ revoked: count });
  });

  // POST /v1/me/session/rotate -- rotate the current session.
  // Uses the session ID from the auth context; no raw token in headers.
  app.post("/v1/me/session/rotate", async (context) => {
    const identity = context.get("identity");
    const rotated = await manager.rotateById(
      identity.session.id,
      identity.user.id,
      new Date(),
      {
        idleTtlMs: deps.idleTtlMs,
        absoluteTtlMs: deps.absoluteTtlMs,
        authMethod: deps.authMethod,
      },
    );
    const cookieMaxAgeSeconds = Math.floor(
      (rotated.absoluteExpiresAt.getTime() - Date.now()) / 1000,
    );
    return context.json({
      token: rotated.token,
      sessionId: rotated.sessionId,
      expiresAt: rotated.expiresAt,
      idleExpiresAt: rotated.idleExpiresAt,
      absoluteExpiresAt: rotated.absoluteExpiresAt,
      cookieMaxAgeSeconds,
    });
  });
}
