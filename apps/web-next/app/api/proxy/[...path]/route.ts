import { NextResponse, type NextRequest } from "next/server";

const TOWN_TOKEN_COOKIE = "town-token";
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

const FORWARDED_HEADERS = [
  "content-type",
  "accept",
  "idempotency-key",
] as const;

/**
 * Authenticated reverse proxy: reads the HttpOnly session cookie and
 * forwards the request to the backend API with a Bearer token.
 *
 * Supports both JSON and Server-Sent Events (SSE) responses. For SSE,
 * the response body is streamed directly through so the client can
 * consume events in real time.
 */
async function proxy(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: pathSegments } = await params;
  const path = pathSegments.join("/");

  const token = request.cookies.get(TOWN_TOKEN_COOKIE)?.value;
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

  const search = request.nextUrl.search;
  const url = `${API_BASE_URL.replace(/\/$/, "")}/${path}${search}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers[name] = value;
  }

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

  if (contentType !== null && contentType.includes("text/event-stream")) {
    if (upstream.body === null) {
      return new NextResponse(null, {
        status: 502,
        headers: responseHeaders,
      });
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
