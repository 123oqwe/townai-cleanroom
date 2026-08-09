import { NextResponse, type NextRequest } from "next/server";

import { getBffSharedSecret, getInternalApiBaseUrl } from "@/lib/server/csrf";
import { setSessionCookie } from "@/lib/server/cookies";

// Phase 01A: Google OIDC callback. The browser lands here after Google
// consent. This BFF route forwards code+state to the API (BFF secret gated),
// receives the session token server-to-server, sets the HttpOnly cookie, and
// redirects to the app. The session token is NEVER returned to browser JS.

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // User denied consent.
  if (error !== null) {
    return NextResponse.redirect(
      new URL(`/new/login?error=access_denied`, request.nextUrl.origin),
    );
  }
  if (code === null || state === null) {
    return NextResponse.redirect(
      new URL(`/new/login?error=invalid_callback`, request.nextUrl.origin),
    );
  }

  let apiUrl: string;
  let secret: string;
  try {
    apiUrl = getInternalApiBaseUrl();
    secret = getBffSharedSecret();
  } catch {
    return NextResponse.redirect(
      new URL(`/new/login?error=not_configured`, request.nextUrl.origin),
    );
  }

  const response = await fetch(`${apiUrl}/v1/auth/oidc/google/callback`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bff-secret": secret,
    },
    body: JSON.stringify({ code, state }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      code?: string;
    };
    const code_err = body.code ?? "auth_failed";
    return NextResponse.redirect(
      new URL(`/new/login?error=${code_err}`, request.nextUrl.origin),
    );
  }

  const result = (await response.json()) as {
    token: string;
    expiresAt: string;
    redirectPath: string;
    user: { id: string; email: string };
  };

  // Normalize the redirect path (prevent open redirect).
  const safePath =
    typeof result.redirectPath === "string" &&
    result.redirectPath.startsWith("/") &&
    !result.redirectPath.startsWith("//")
      ? result.redirectPath
      : "/new/threads";

  const redirect = NextResponse.redirect(
    new URL(safePath, request.nextUrl.origin),
  );
  setSessionCookie(redirect, result.token);
  return redirect;
}
