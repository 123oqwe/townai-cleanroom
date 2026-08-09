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
    apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3000";
  }

  const response = await fetch(`${apiBase}/v1/me/session/rotate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-session-token": token,
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
  };
  const res = NextResponse.json({
    sessionId: result.sessionId,
    expiresAt: result.expiresAt,
  });
  setSessionCookie(res, result.token);
  return res;
}
