import { NextResponse, type NextRequest } from "next/server";

// Phase 01A: session cookie name inlined for the edge middleware (cannot
// import the node:crypto-dependent cookies module). Keep in sync with
// lib/server/cookies.ts SESSION_COOKIE.
const isProduction = process.env.NODE_ENV === "production";
const SESSION_COOKIE = isProduction ? "__Host-town-session" : "town-session";

// Protect /new/* (except /new/login). No token cookie -> redirect to /new/login.
// The cookie is HttpOnly, so middleware (running on the edge/server) can read
// it, but client-side JavaScript cannot.
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value ?? "";
  const isLogin = pathname === "/new/login";

  if (token === "") {
    if (isLogin) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = "/new/login";
    return NextResponse.redirect(url);
  }

  // Authenticated users hitting /new/login bounce to the app.
  if (isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/new/threads";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/new/:path*"],
};
