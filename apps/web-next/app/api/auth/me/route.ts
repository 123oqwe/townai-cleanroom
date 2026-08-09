import { NextResponse, type NextRequest } from "next/server";

import { TownApiError, TownClient } from "@town/web-client";

const TOWN_TOKEN_COOKIE = "town-token";
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(TOWN_TOKEN_COOKIE)?.value;

  if (token === undefined || token.length === 0) {
    return NextResponse.json(
      { code: "UNAUTHENTICATED", detail: "No session token." },
      { status: 401 },
    );
  }

  const client = new TownClient({ baseUrl: API_BASE_URL, token });
  try {
    const user = await client.me.get();
    return NextResponse.json({ user });
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
