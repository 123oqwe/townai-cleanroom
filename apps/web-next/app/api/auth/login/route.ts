import { NextResponse, type NextRequest } from "next/server";

import { setSessionCookie } from "@/lib/server/cookies";
import {
  parseServerCookieMaxAge,
  getMaxAbsoluteTtlMs,
  CookieTtlError,
} from "@/lib/server/cookie-ttl";
import {
  assertSameOriginRequest,
  getInternalApiBaseUrl,
} from "@/lib/server/csrf";

// Phase 01A: DEV-ONLY email login BFF route. In production this route must
// not be reachable; the login page only offers "Continue with Google". This
// route exists for local/E2E testing against /v1/auth/dev-session.

const isProduction = process.env.NODE_ENV === "production";

export async function POST(request: NextRequest) {
  // Fail closed in production builds.
  if (isProduction) {
    return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
  }

  const csrf = assertSameOriginRequest(request);
  if (!csrf.ok) {
    return NextResponse.json(
      { code: csrf.reason ?? "CSRF_REJECTED" },
      { status: 403 },
    );
  }

  let email: string;
  try {
    const body = (await request.json()) as { email?: unknown };
    if (typeof body.email !== "string" || body.email.trim().length === 0) {
      return NextResponse.json(
        { code: "INVALID_REQUEST", detail: "Email is required." },
        { status: 400 },
      );
    }
    email = body.email.trim();
  } catch {
    return NextResponse.json(
      { code: "INVALID_REQUEST", detail: "Invalid JSON body." },
      { status: 400 },
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

  const response = await fetch(`${apiBase}/v1/auth/dev-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      code?: string;
      detail?: string;
    };
    return NextResponse.json(
      {
        code: body.code ?? "INTERNAL_ERROR",
        detail: body.detail ?? "Could not sign in.",
      },
      { status: response.status },
    );
  }

  const result = (await response.json()) as {
    token: string;
    user: { email: string };
    session: { id: string; expiresAt: string };
    cookieMaxAgeSeconds?: number;
  };
  let maxAge: number;
  try {
    maxAge = parseServerCookieMaxAge(
      result.cookieMaxAgeSeconds,
      getMaxAbsoluteTtlMs(),
    );
  } catch (error: unknown) {
    if (error instanceof CookieTtlError) {
      return NextResponse.json(
        { code: "SESSION_TTL_INVALID", detail: error.message },
        { status: 502 },
      );
    }
    throw error;
  }
  const res = NextResponse.json({
    user: result.user,
    session: { id: result.session.id, expiresAt: result.session.expiresAt },
  });
  setSessionCookie(res, result.token, { maxAge });
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Pragma", "no-cache");
  return res;
}
