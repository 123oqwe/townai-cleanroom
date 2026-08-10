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

// Phase 01A: logout-all revokes ALL sessions (including current) server-side
// and clears the cookie. Uses /v1/me/sessions/all endpoint.
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
    return buildLogoutResponse({
      httpStatus: 503,
      serverSessionRevoked: false,
      status: "degraded",
      code: "LOGOUT_DEGRADED",
    });
  }

  try {
    const upstream = await fetch(`${apiBase}/v1/me/sessions/all`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(LOGOUT_TIMEOUT_MS),
    });
    let revokedCount: number | undefined;
    if (upstream.ok) {
      const body = (await upstream.json().catch(() => ({}))) as {
        revoked?: number;
      };
      revokedCount = body.revoked;
    }
    const classified = classifyLogoutResponse(
      upstream.ok,
      upstream.status,
      revokedCount,
    );
    return buildLogoutResponse(classified);
  } catch {
    return buildLogoutResponse({
      httpStatus: 502,
      serverSessionRevoked: false,
      status: "degraded",
      code: "LOGOUT_DEGRADED",
    });
  }
}
