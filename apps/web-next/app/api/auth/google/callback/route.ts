import { NextResponse, type NextRequest } from "next/server";

import { getBffSharedSecret, getInternalApiBaseUrl } from "@/lib/server/csrf";
import {
  setSessionCookie,
  readOidcBindingCookie,
  clearOidcBindingCookie,
} from "@/lib/server/cookies";
import {
  parseServerCookieMaxAge,
  getMaxAbsoluteTtlMs,
  CookieTtlError,
} from "@/lib/server/cookie-ttl";
import {
  normalizePostLoginRedirect,
  SAFE_FALLBACK_REDIRECT,
} from "@town/identity";

// Phase 01A: Google OIDC callback. The browser lands here after Google
// consent. This BFF route forwards code+state to the API (BFF secret gated),
// receives the session token server-to-server, sets the HttpOnly cookie, and
// redirects to the app. The session token is NEVER returned to browser JS.
//
// ALL callback paths (success, error, network failure) MUST clear the
// OIDC flow cookie.

/** Get the trusted web origin from configuration, never from request.nextUrl.origin. */
function getTrustedWebOrigin(): string {
  const origin = process.env.WEB_ORIGIN;
  if (origin === undefined || origin.length === 0) {
    throw new Error("WEB_ORIGIN is not configured.");
  }
  return origin;
}

/** Redirect to login with an error, always clearing the flow cookie. */
function redirectToLoginWithError(error: string): NextResponse {
  // Use the configured WEB_ORIGIN only — never request.nextUrl.origin
  // (which can be spoofed by an attacker in certain hosting setups).
  const trustedOrigin = getTrustedWebOrigin();
  const loginUrl = new URL("/new/login", trustedOrigin);
  loginUrl.searchParams.set("error", error);
  const res = NextResponse.redirect(loginUrl);
  clearOidcBindingCookie(res);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Pragma", "no-cache");
  return res;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // Verify WEB_ORIGIN is configured before any redirect path.
  // All error/success redirects use this origin, never request.nextUrl.origin.
  try {
    getTrustedWebOrigin();
  } catch {
    const res = NextResponse.json(
      { code: "AUTH_NOT_CONFIGURED" },
      { status: 503 },
    );
    clearOidcBindingCookie(res);
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("Pragma", "no-cache");
    return res;
  }

  // User denied consent — clear flow cookie.
  if (error !== null) {
    return redirectToLoginWithError("access_denied");
  }
  // Missing code or state — clear flow cookie.
  if (code === null || state === null) {
    return redirectToLoginWithError("invalid_callback");
  }

  let apiUrl: string;
  let secret: string;
  try {
    apiUrl = getInternalApiBaseUrl();
    secret = getBffSharedSecret();
  } catch {
    return redirectToLoginWithError("not_configured");
  }

  // Read the per-browser binding cookie. If missing — clear and reject.
  const browserBindingSecret = readOidcBindingCookie(request.cookies);
  if (browserBindingSecret === undefined) {
    return redirectToLoginWithError("invalid_flow");
  }

  let response: Response;
  try {
    response = await fetch(`${apiUrl}/v1/auth/oidc/google/callback`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bff-secret": secret,
      },
      body: JSON.stringify({ code, state, browserBindingSecret }),
    });
  } catch {
    // Network error — clear flow cookie.
    return redirectToLoginWithError("auth_failed");
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      code?: string;
    };
    // UI error allowlist: map known API error codes to safe UI codes.
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
      INVALID_REDIRECT_PATH: "auth_failed",
    };
    const uiError =
      body.code !== undefined && body.code in UI_ERROR_MAP
        ? (UI_ERROR_MAP[body.code] ?? "auth_failed")
        : "auth_failed";
    return redirectToLoginWithError(uiError);
  }

  const result = (await response.json()) as {
    token: string;
    expiresAt: string;
    redirectPath: string;
    user: { id: string; email: string };
    cookieMaxAgeSeconds?: number;
  };

  // Validate cookie TTL strictly — no fallback.
  let maxAge: number;
  try {
    maxAge = parseServerCookieMaxAge(
      result.cookieMaxAgeSeconds,
      getMaxAbsoluteTtlMs(),
    );
  } catch (error: unknown) {
    if (error instanceof CookieTtlError) {
      return redirectToLoginWithError("auth_failed");
    }
    throw error;
  }

  // Validate redirect path using the shared canonicalization module.
  let safePath: string;
  try {
    const trustedOrigin = getTrustedWebOrigin();
    safePath = normalizePostLoginRedirect(result.redirectPath, trustedOrigin);
  } catch {
    safePath = SAFE_FALLBACK_REDIRECT;
  }

  // WEB_ORIGIN was already verified at the top of GET().
  const redirect = NextResponse.redirect(
    new URL(safePath, getTrustedWebOrigin()),
  );
  setSessionCookie(redirect, result.token, { maxAge });
  clearOidcBindingCookie(redirect);
  redirect.headers.set("Cache-Control", "no-store");
  redirect.headers.set("Pragma", "no-cache");
  return redirect;
}
