import { NextResponse, type NextRequest } from "next/server";

// Keep this in sync with `TOWN_TOKEN_COOKIE` in app/api-client.tsx. Inlined here
// so the edge middleware does not pull the client-component module graph.
const TOWN_TOKEN_COOKIE = "town-token";

// Protect /new/* (except /new/login). No token cookie -> redirect to /new/login.
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(TOWN_TOKEN_COOKIE)?.value ?? "";
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
