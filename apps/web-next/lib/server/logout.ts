import { NextResponse } from "next/server";
import { clearSessionCookie } from "./cookies";

/**
 * Unified logout response builder.
 *
 * ALL logout responses (success, degraded, error) MUST clear the session cookie.
 * The response contract is:
 *
 * {
 *   "localSessionCleared": true,
 *   "serverSessionRevoked": true | false,
 *   "revokedCount": number | null,
 *   "status": "complete" | "degraded",
 *   "code": "OK" | "LOGOUT_DEGRADED"
 * }
 */

export interface LogoutResponseOptions {
  httpStatus: number;
  serverSessionRevoked: boolean;
  revokedCount?: number | null;
  status: "complete" | "degraded";
  code: "OK" | "LOGOUT_DEGRADED";
}

export function buildLogoutResponse(
  options: LogoutResponseOptions,
): NextResponse {
  const response = NextResponse.json(
    {
      localSessionCleared: true,
      serverSessionRevoked: options.serverSessionRevoked,
      revokedCount: options.revokedCount ?? null,
      status: options.status,
      code: options.code,
    },
    { status: options.httpStatus },
  );
  // ALWAYS clear the session cookie, regardless of error state.
  clearSessionCookie(response);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");
  return response;
}

/**
 * Classify an upstream API response for logout operations.
 *
 * 2xx: complete, serverSessionRevoked=true
 * 401/404: complete (session already invalid/revoked), serverSessionRevoked=true
 * 5xx / network: degraded, serverSessionRevoked=false
 */
export function classifyLogoutResponse(
  ok: boolean,
  status: number,
  revokedCount?: number,
): LogoutResponseOptions {
  if (ok || status === 401 || status === 404) {
    return {
      httpStatus: 200,
      serverSessionRevoked: true,
      revokedCount: revokedCount ?? null,
      status: "complete",
      code: "OK",
    };
  }
  return {
    httpStatus: status >= 500 ? 502 : 502,
    serverSessionRevoked: false,
    revokedCount: revokedCount ?? null,
    status: "degraded",
    code: "LOGOUT_DEGRADED",
  };
}
