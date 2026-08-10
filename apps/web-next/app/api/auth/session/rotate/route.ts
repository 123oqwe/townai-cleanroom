import { NextResponse, type NextRequest } from "next/server";

import { readSessionCookie, setSessionCookie } from "@/lib/server/cookies";
import {
  assertSameOriginRequest,
  getInternalApiBaseUrl,
} from "@/lib/server/csrf";

// Phase 01A: rotate the current session. The old token is invalidated
// server-side; the new token replaces the cookie atomically.

export async function POST(request: NextRequest) {
  const csrf = assertSameOriginRequest(request);
  if (!csrf.ok) {
    return NextResponse.json(
      { code: csrf.reason ?? "CSRF_REJECTED" },
      { status: 403 },
    );
  }

  const token = readSessionCookie(request.cookies);
  if (token === undefined || token.length === 0) {
    return NextResponse.json({ code: "UNAUTHENTICATED" }, { status: 401 });
  }

  let apiBase: string;
  try {
    apiBase = getInternalApiBaseUrl();
  } catch {
    return NextResponse.json(
      { code: "AUTH_NOT_CONFIGURED", detail: "Server API is not configured." },
      { status: 503 },
    );
  }

  const response = await fetch(`${apiBase}/v1/me/session/rotate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    return NextResponse.json(
      { code: "SESSION_REVOKED" },
      { status: response.status },
    );
  }

  const result = (await response.json()) as {
    token: string;
    sessionId: string;
    expiresAt: string;
    cookieMaxAgeSeconds?: number;
  };
  const res = NextResponse.json({
    sessionId: result.sessionId,
    expiresAt: result.expiresAt,
  });
  // Use server-authoritative cookie max age.
  setSessionCookie(res, result.token, {
    maxAge:
      result.cookieMaxAgeSeconds ??
      Math.floor(
        (Number(process.env.AUTH_SESSION_ABSOLUTE_TTL_MS) || 604800000) / 1000,
      ),
  });
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Pragma", "no-cache");
  return res;
}
