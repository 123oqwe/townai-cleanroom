import { NextResponse, type NextRequest } from "next/server";

import { TownApiError, TownClient } from "@town/web-client";

const TOWN_TOKEN_COOKIE = "town-token";
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(TOWN_TOKEN_COOKIE)?.value;

  // Always clear the cookie regardless of backend outcome.
  const response = NextResponse.json({ ok: true });

  if (token !== undefined && token.length > 0) {
    const client = new TownClient({ baseUrl: API_BASE_URL, token });
    try {
      await client.auth.deleteSession();
    } catch (err) {
      // If the backend rejects (expired/invalid token), still clear the cookie
      // so the user is logged out client-side. Log non- TownApiError for
      // debugging, but don't block logout.
      if (!(err instanceof TownApiError)) {
        console.error("Logout backend call failed:", err);
      }
    }
  }

  response.cookies.set(TOWN_TOKEN_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
