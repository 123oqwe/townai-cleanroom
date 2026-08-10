import { NextResponse, type NextRequest } from "next/server";

import { getBffSharedSecret, getInternalApiBaseUrl } from "@/lib/server/csrf";
// Phase 01A: BFF route that initiates Google OIDC login. Calls the API's
// server-to-server OIDC start endpoint (BFF secret gated), then redirects the
// browser to Google's consent page. The browser never sees the BFF secret.

export async function POST(request: NextRequest) {
  const redirectPath = await request
    .json()
    .then((b) =>
      typeof (b as { redirectPath?: string })?.redirectPath === "string"
        ? (b as { redirectPath: string }).redirectPath
        : "/",
    )
    .catch(() => "/");

  let apiUrl: string;
  let secret: string;
  try {
    apiUrl = getInternalApiBaseUrl();
    secret = getBffSharedSecret();
  } catch {
    const res = NextResponse.json(
      { code: "AUTH_NOT_CONFIGURED", detail: "Server auth is not configured." },
      { status: 503 },
    );
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("Pragma", "no-cache");
    return res;
  }

  const response = await fetch(`${apiUrl}/v1/auth/oidc/google/start`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bff-secret": secret,
    },
    body: JSON.stringify({ redirectPath }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      code?: string;
    };
    return NextResponse.json(
      { code: body.code ?? "AUTH_START_FAILED" },
      { status: response.status },
    );
  }

  const result = (await response.json()) as {
    authorizationUrl: string;
  };
  const res = NextResponse.json({ authorizationUrl: result.authorizationUrl });
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Pragma", "no-cache");
  return res;
}
