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
  clearSessionCookie(response);

  if (token !== undefined && token.length > 0) {
    let apiBase: string;
    try {
      apiBase = getInternalApiBaseUrl();
    } catch {
      apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3000";
    }
    try {
      await fetch(`${apiBase}/v1/me/sessions`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Cookie still cleared.
    }
  }
  return response;
}
