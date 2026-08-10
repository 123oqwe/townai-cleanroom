import { NextResponse, type NextRequest } from "next/server";

import { readSessionCookie } from "@/lib/server/cookies";
import {
  assertSameOriginRequest,
  getInternalApiBaseUrl,
} from "@/lib/server/csrf";
import {
  buildLogoutResponse,
  classifyLogoutResponse,
} from "@/lib/server/logout";

// Phase 01A: logout revokes the current session server-side and clears the
// cookie. Cross-origin logout is rejected by CSRF.
// ALL error paths still clear the cookie and return the unified contract.

const LOGOUT_TIMEOUT_MS = 5_000;

export async function POST(request: NextRequest) {
  const csrf = assertSameOriginRequest(request);
  if (!csrf.ok) {
    return NextResponse.json(
      { code: csrf.reason ?? "CSRF_REJECTED" },
      { status: 403 },
    );
  }

  const token = readSessionCookie(request.cookies);

  // If no token, session is already cleared.
  if (token === undefined || token.length === 0) {
    return buildLogoutResponse({
      httpStatus: 200,
      serverSessionRevoked: true,
      revokedCount: 0,
      status: "complete",
      code: "OK",
    });
  }

  let apiBase: string;
  try {
    apiBase = getInternalApiBaseUrl();
  } catch {
    // Config missing — cookie cleared, server state unknown.
    return buildLogoutResponse({
      httpStatus: 503,
      serverSessionRevoked: false,
      status: "degraded",
      code: "LOGOUT_DEGRADED",
    });
  }

  try {
    const upstream = await fetch(`${apiBase}/v1/me/session`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(LOGOUT_TIMEOUT_MS),
    });
    const classified = classifyLogoutResponse(upstream.ok, upstream.status);
    return buildLogoutResponse(classified);
  } catch {
    // Network failure / timeout — cookie cleared, server state unknown.
    return buildLogoutResponse({
      httpStatus: 502,
      serverSessionRevoked: false,
      status: "degraded",
      code: "LOGOUT_DEGRADED",
    });
  }
}
