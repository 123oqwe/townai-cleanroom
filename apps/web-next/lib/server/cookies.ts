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

// Cookie TTL must match the backend session lifetime (absolute TTL).
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days, matches AUTH_SESSION_ABSOLUTE_TTL_MS

export interface CookieOptions {
  maxAge?: number;
}

/** Set the session cookie on a response with full production hardening. */
export function setSessionCookie(
  response: NextResponse,
  token: string,
  options: CookieOptions = {},
): void {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    ...(isProduction ? { domain: undefined } : {}),
    priority: "high" as const,
    maxAge: options.maxAge ?? SESSION_MAX_AGE,
    expires: new Date(Date.now() + (options.maxAge ?? SESSION_MAX_AGE) * 1_000),
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
