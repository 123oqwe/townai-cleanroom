import { NextResponse, type NextRequest } from "next/server";

import { readSessionCookie } from "@/lib/server/cookies";
import {
  assertSameOriginRequest,
  getInternalApiBaseUrl,
} from "@/lib/server/csrf";

// Phase 01A: authenticated reverse proxy. Reads the HttpOnly session cookie,
// injects a Bearer token server-to-server, forwards to the backend API via
// INTERNAL_API_BASE_URL (never NEXT_PUBLIC_). Enforces same-origin CSRF on
// mutations. Path-normalized to prevent traversal. Cookies are never forwarded.

const FORWARDED_HEADERS = [
  "content-type",
  "accept",
  "idempotency-key",
] as const;

async function proxy(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: pathSegments } = await params;

  // Path normalization: reject traversal and empty segments.
  const path = pathSegments
    .map((seg) => decodeURIComponent(seg))
    .filter((seg) => seg.length > 0 && !seg.includes(".."))
    .join("/");
  if (path.length === 0) {
    return NextResponse.json({ code: "BAD_REQUEST" }, { status: 400 });
  }

  // CSRF: reject cross-origin mutations before doing any work.
  const csrf = assertSameOriginRequest(request);
  if (!csrf.ok) {
    return NextResponse.json(
      {
        code: csrf.reason ?? "CSRF_REJECTED",
        detail: "Cross-origin request rejected.",
      },
      { status: 403 },
    );
  }

  const token = readSessionCookie(request.cookies);
  if (token === undefined || token.length === 0) {
    return NextResponse.json(
      {
        type: "https://town.local/problems/unauthenticated",
        title: "Authentication required",
        status: 401,
        detail: "A valid bearer session is required.",
        code: "UNAUTHENTICATED",
      },
      { status: 401 },
    );
  }

  let apiBase: string;
  try {
    apiBase = getInternalApiBaseUrl();
  } catch {
    return NextResponse.json(
      { code: "INTERNAL_ERROR", detail: "API endpoint not configured." },
      { status: 503 },
    );
  }

  const search = request.nextUrl.search;
  const url = `${apiBase}/${path}${search}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  // Never forward the browser Cookie header to the backend.
  // Never allow a user-supplied Authorization header to override the session.

  const init: RequestInit = {
    method: request.method,
    headers,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    const body = await request.text();
    if (body.length > 0) init.body = body;
  }

  const upstream = await fetch(url, init);

  const responseHeaders = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType !== null) responseHeaders.set("content-type", contentType);

  // SSE: stream the body through.
  if (contentType !== null && contentType.includes("text/event-stream")) {
    if (upstream.body === null) {
      return new NextResponse(null, { status: 502, headers: responseHeaders });
    }
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  }

  const responseBody = await upstream.arrayBuffer();
  return new NextResponse(responseBody, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
