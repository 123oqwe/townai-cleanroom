import { NextResponse, type NextRequest } from "next/server";

import { clearSessionCookie, readSessionCookie } from "@/lib/server/cookies";
import {
  assertSameOriginRequest,
  getInternalApiBaseUrl,
} from "@/lib/server/csrf";

export async function POST(request: NextRequest) {
  const csrf = assertSameOriginRequest(request);
  if (!csrf.ok) {
    return NextResponse.json(
      { code: csrf.reason ?? "CSRF_REJECTED" },
      { status: 403 },
    );
  }

  const token = readSessionCookie(request.cookies);
  const response = NextResponse.json({ ok: true });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");
  clearSessionCookie(response);

  if (token !== undefined && token.length > 0) {
    let apiBase: string;
    try {
      apiBase = getInternalApiBaseUrl();
    } catch {
      // Cannot reach backend without INTERNAL_API_BASE_URL.
      return response;
    }
    const upstream = await fetch(`${apiBase}/v1/me/sessions`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!upstream.ok && upstream.status !== 401 && upstream.status !== 404) {
      return NextResponse.json(
        { code: "LOGOUT_DEGRADED", detail: "Sessions may still be active." },
        { status: 502 },
      );
    }
  }
  return response;
}
