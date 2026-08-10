import type { NextResponse } from "next/server";

// Phase 01A: unified server-only cookie configuration.
// Single source of truth for the session cookie name and options so they are
// never hardcoded across multiple route handlers.

const isProduction = process.env.NODE_ENV === "production";

// __Host- prefix forces Secure + Path=/ + no Domain in production.
// Local dev uses plain name because HTTP cannot use __Host- + Secure.
export const SESSION_COOKIE = isProduction
  ? "__Host-town-session"
  : "town-session";

export const DEV_LOGIN_COOKIE = "town-dev-session"; // never used in prod

// Per-browser OIDC flow binding cookie. Set at /api/auth/google/start,
// verified at /api/auth/google/callback. Prevents a stolen state from
// completing the flow from a different browser.
export const OIDC_BINDING_COOKIE = isProduction
  ? "__Host-town-auth-flow"
  : "town-auth-flow";

/** Set the OIDC browser binding cookie (short-lived, HttpOnly). */
export function setOidcBindingCookie(
  response: NextResponse,
  secret: string,
): void {
  response.cookies.set(OIDC_BINDING_COOKIE, secret, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 300, // 5 minutes (matches ATTEMPT_TTL_MS)
    expires: new Date(Date.now() + 300 * 1_000),
  });
}

/** Read the OIDC browser binding cookie value from a request. */
export function readOidcBindingCookie(cookieStore: {
  get: (name: string) => { value: string } | undefined;
}): string | undefined {
  return cookieStore.get(OIDC_BINDING_COOKIE)?.value;
}

/** Clear the OIDC browser binding cookie. */
export function clearOidcBindingCookie(response: NextResponse): void {
  response.cookies.set(OIDC_BINDING_COOKIE, "", {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}

// Cookie max age MUST come from the server-authoritative session response.
// No hardcoded fallback TTL — the API always returns cookieMaxAgeSeconds.
export interface CookieOptions {
  maxAge: number;
}

/** Set the session cookie on a response with full production hardening. */
export function setSessionCookie(
  response: NextResponse,
  token: string,
  options: CookieOptions,
): void {
  if (
    typeof options.maxAge !== "number" ||
    !Number.isSafeInteger(options.maxAge) ||
    options.maxAge <= 0
  ) {
    throw new Error(
      "Cookie maxAge must be a safe positive integer from the server-authoritative session response.",
    );
  }
  const maxAge = options.maxAge;
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    ...(isProduction ? { domain: undefined } : {}),
    priority: "high" as const,
    maxAge,
    expires: new Date(Date.now() + maxAge * 1_000),
  });
}

/** Clear the session cookie (logout). */
export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}

/** Read the session cookie value from a request. */
export function readSessionCookie(cookieStore: {
  get: (name: string) => { value: string } | undefined;
}): string | undefined {
  return cookieStore.get(SESSION_COOKIE)?.value;
}

/** Production cookie attributes for testing. */
export function productionCookieAttributes() {
  return {
    name: "__Host-town-session",
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    priority: "high" as const,
  };
}
