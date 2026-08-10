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
    // UI error allowlist: map known API error codes to safe UI codes.
    // Unknown errors map to a generic auth_failed.
    const UI_ERROR_MAP: Record<string, string> = {
      AUTH_ACCOUNT_NOT_ALLOWED: "account_not_allowed",
      AUTH_FLOW_EXPIRED: "flow_expired",
      AUTH_FLOW_REPLAYED: "flow_replayed",
      AUTH_FLOW_INVALID: "invalid_flow",
      AUTH_BROWSER_BINDING_INVALID: "invalid_flow",
      AUTH_STATE_INVALID: "invalid_flow",
      AUTH_TOKEN_EXCHANGE_FAILED: "provider_error",
      AUTH_NOT_CONFIGURED: "not_configured",
      AUTH_IDENTITY_CONFLICT: "auth_failed",
    };
    const uiError =
      body.code !== undefined && body.code in UI_ERROR_MAP
        ? (UI_ERROR_MAP[body.code] ?? "auth_failed")
        : "auth_failed";
    const loginUrl = new URL("/new/login", request.nextUrl.origin);
    loginUrl.searchParams.set("error", uiError);
    return NextResponse.redirect(loginUrl);
  }

  const result = (await response.json()) as {
    token: string;
    expiresAt: string;
    redirectPath: string;
    user: { id: string; email: string };
    cookieMaxAgeSeconds?: number;
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
  setSessionCookie(redirect, result.token, {
    maxAge: result.cookieMaxAgeSeconds,
  });
  redirect.headers.set("Cache-Control", "no-store");
  redirect.headers.set("Pragma", "no-cache");
  return redirect;
}
