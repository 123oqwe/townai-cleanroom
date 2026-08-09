import { NextResponse, type NextRequest } from "next/server";

import { TownApiError, TownClient } from "@town/web-client";

const TOWN_TOKEN_COOKIE = "town-token";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

export async function POST(request: NextRequest) {
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

  const client = new TownClient({ baseUrl: API_BASE_URL });
  try {
    const result = await client.auth.createSession(email);
    const response = NextResponse.json({
      user: result.user,
      session: { id: result.session.id, expiresAt: result.session.expiresAt },
    });
    response.cookies.set(TOWN_TOKEN_COOKIE, result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (err) {
    if (err instanceof TownApiError) {
      return NextResponse.json(
        { code: err.code, detail: err.message },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { code: "INTERNAL_ERROR", detail: "Could not connect to the API." },
      { status: 502 },
    );
  }
}
