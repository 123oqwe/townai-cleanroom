import { NextResponse, type NextRequest } from "next/server";

import {
  assertSameOriginRequest,
  getBffSharedSecret,
  getInternalApiBaseUrl,
} from "@/lib/server/csrf";
import { setOidcBindingCookie } from "@/lib/server/cookies";
// Phase 01A: BFF route that initiates Google OIDC login. Calls the API's
// server-to-server OIDC start endpoint (BFF secret gated), then redirects the
// browser to Google's consent page. The browser never sees the BFF secret.

export async function POST(request: NextRequest) {
  const csrf = assertSameOriginRequest(request);
  if (!csrf.ok) {
    return NextResponse.json(
      { code: csrf.reason ?? "CSRF_REJECTED" },
      { status: 403 },
    );
  }

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

  // Generate a per-browser binding secret. The API stores its hash; the
  // callback must present the same secret to complete the flow.
  const browserBindingSecret = crypto.randomUUID() + crypto.randomUUID();

  const response = await fetch(`${apiUrl}/v1/auth/oidc/google/start`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bff-secret": secret,
    },
    body: JSON.stringify({ redirectPath, browserBindingSecret }),
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
    browserBindingSecret?: string;
  };
  // Use the API-returned secret if provided (it may regenerate if ours
  // was too short), otherwise use the one we generated.
  const bindingSecret = result.browserBindingSecret ?? browserBindingSecret;
  const res = NextResponse.json({ authorizationUrl: result.authorizationUrl });
  setOidcBindingCookie(res, bindingSecret);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Pragma", "no-cache");
  return res;
}
