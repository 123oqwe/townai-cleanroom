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
    apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3000";
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
    return NextResponse.json(body);
  } catch {
    return NextResponse.json(
      { code: "INTERNAL_ERROR", detail: "Could not connect to the API." },
      { status: 502 },
    );
  }
}
