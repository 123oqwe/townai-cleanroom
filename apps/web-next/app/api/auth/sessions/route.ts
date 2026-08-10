import { NextResponse, type NextRequest } from "next/server";

import { readSessionCookie, clearSessionCookie } from "@/lib/server/cookies";
import {
  assertSameOriginRequest,
  getInternalApiBaseUrl,
} from "@/lib/server/csrf";

// Phase 01A: list active sessions for the session-management UI.

export async function GET(request: NextRequest) {
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

  const response = await fetch(`${apiBase}/v1/me/sessions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    return NextResponse.json(
      { code: "UNAUTHENTICATED" },
      { status: response.status },
    );
  }
  const body = (await response.json()) as { sessions: unknown[] };
  const res = NextResponse.json(body);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Pragma", "no-cache");
  return res;
}

export async function DELETE(request: NextRequest) {
  const csrf = assertSameOriginRequest(request);
  if (!csrf.ok) {
    return NextResponse.json(
      { code: csrf.reason ?? "CSRF_REJECTED" },
      { status: 403 },
    );
  }

  // Revoke a single session by id (query param) or all other (no param).
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

  const sessionId = request.nextUrl.searchParams.get("id");
  if (sessionId !== null) {
    // Validate sessionId is a UUID before using it.
    // Validate sessionId is a UUID before using it.
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(sessionId)) {
      return NextResponse.json({ code: "INVALID_SESSION_ID" }, { status: 400 });
    }
    const target = new URL(
      `/v1/me/sessions/${encodeURIComponent(sessionId)}`,
      apiBase,
    );
    const response = await fetch(target, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    // Read upstream response to check if the current session was revoked.
    let revokedCurrent = false;
    if (response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        revokedCurrent?: boolean;
      };
      revokedCurrent = body.revokedCurrent === true;
    }
    const res = NextResponse.json(
      { revokedCurrent },
      { status: response.status },
    );
    if (revokedCurrent) {
      clearSessionCookie(res);
    }
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("Pragma", "no-cache");
    return res;
  }
  // No id — revoke all other sessions.
  const target = new URL("/v1/me/sessions", apiBase);
  const response = await fetch(target, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  const res = new NextResponse(null, { status: response.status });
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Pragma", "no-cache");
  return res;
}
