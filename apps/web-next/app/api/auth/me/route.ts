import { NextResponse, type NextRequest } from "next/server";

import { readSessionCookie } from "@/lib/server/cookies";
import { getInternalApiBaseUrl } from "@/lib/server/csrf";

// Phase 01A: returns the current user from the session cookie. Never exposes
// the raw session token to the browser.

export async function GET(request: NextRequest) {
  const token = readSessionCookie(request.cookies);
  if (token === undefined || token.length === 0) {
    return NextResponse.json(
      { code: "UNAUTHENTICATED", detail: "No session token." },
      { status: 401 },
    );
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

  try {
    const response = await fetch(`${apiBase}/v1/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      return NextResponse.json(
        { code: "UNAUTHENTICATED", detail: "Session invalid." },
        { status: response.status },
      );
    }
    const body = (await response.json()) as { user: unknown };
    const res = NextResponse.json(body);
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("Pragma", "no-cache");
    return res;
  } catch {
    return NextResponse.json(
      { code: "INTERNAL_ERROR", detail: "Could not connect to the API." },
      { status: 502 },
    );
  }
}
