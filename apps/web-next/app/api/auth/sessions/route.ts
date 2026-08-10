import { NextResponse, type NextRequest } from "next/server";

import { readSessionCookie } from "@/lib/server/cookies";
import { getInternalApiBaseUrl } from "@/lib/server/csrf";

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
  // Revoke a single session by id (query param) or all (no param).
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
  const target =
    sessionId !== null
      ? `${apiBase}/v1/me/sessions/${sessionId}`
      : `${apiBase}/v1/me/sessions`;
  const response = await fetch(target, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  return new NextResponse(null, { status: response.status });
}
