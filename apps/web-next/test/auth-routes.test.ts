import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock NEXT_PUBLIC_API_BASE_URL before importing the route handlers.
process.env.NEXT_PUBLIC_API_BASE_URL = "http://127.0.0.1:3000";

// We must import the route handlers after setting env. Since these are
// Next.js route handlers, they use NextRequest/NextResponse. We test by
// constructing NextRequest objects and calling the exported handlers.

import { POST as loginPOST } from "../app/api/auth/login/route";
import { POST as logoutPOST } from "../app/api/auth/logout/route";
import { GET as meGET } from "../app/api/auth/me/route";

function makeRequest(
  url: string,
  init: { method: string; body?: unknown; cookies?: Record<string, string> },
) {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const req = new Request(`http://localhost:3001${url}`, {
    method: init.method,
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  // NextRequest extends Request and adds cookies. We simulate by
  // monkey-patching. The real NextRequest is available in the test env
  // because @next/types is installed, but constructing one directly from
  // Request is simplest for unit tests.
  const nextReq = req as unknown as {
    cookies: {
      get: (name: string) => { value: string } | undefined;
    };
    json: () => Promise<unknown>;
    headers: Headers;
    method: string;
  };
  const cookies = init.cookies ?? {};
  nextReq.cookies = {
    get: (name: string) => {
      const value = cookies[name];
      return value === undefined ? undefined : { value };
    },
  };
  return nextReq as unknown as Parameters<typeof loginPOST>[0];
}

describe("auth login route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 for missing email", async () => {
    const req = makeRequest("/api/auth/login", {
      method: "POST",
      body: {},
    });
    const res = await loginPOST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("INVALID_REQUEST");
  });

  it("returns 400 for invalid JSON", async () => {
    const req = new Request("http://localhost:3001/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    }) as unknown as Parameters<typeof loginPOST>[0];
    // Override json() to throw
    Object.defineProperty(req, "json", {
      value: async () => {
        throw new SyntaxError("Unexpected token");
      },
    });
    const res = await loginPOST(req);
    expect(res.status).toBe(400);
  });

  it("sets HttpOnly cookie on successful login", async () => {
    const fakeUser = {
      id: "user_01JTEST",
      email: "test@example.com",
      firstName: "Test",
      lastName: "User",
      timezone: "UTC",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          token: "town_session_testtoken123",
          user: fakeUser,
          session: {
            id: "auth-session-123",
            expiresAt: "2026-09-01T00:00:00Z",
          },
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const req = makeRequest("/api/auth/login", {
      method: "POST",
      body: { email: "test@example.com" },
    });
    const res = await loginPOST(req);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).not.toBeNull();
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("town-token=town_session_testtoken123");
    expect(setCookie).toContain("SameSite=lax");
    const body = (await res.json()) as { user: { email: string } };
    expect(body.user.email).toBe("test@example.com");
    // Token must NOT appear in the JSON body
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain("town_session_testtoken123");
  });

  it("returns 403 when backend rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "https://town.local/problems/forbidden",
          title: "Forbidden",
          status: 403,
          detail: "This identity is not allowed.",
          code: "ACCESS_DENIED",
        }),
        {
          status: 403,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const req = makeRequest("/api/auth/login", {
      method: "POST",
      body: { email: "notallowed@example.com" },
    });
    const res = await loginPOST(req);
    expect(res.status).toBe(403);
  });
});

describe("auth me route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 401 when no cookie", async () => {
    const req = makeRequest("/api/auth/me", {
      method: "GET",
      cookies: {},
    });
    const res = await meGET(req);
    expect(res.status).toBe(401);
  });

  it("returns user when authenticated", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          user: { id: "user_01", email: "test@example.com" },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const req = makeRequest("/api/auth/me", {
      method: "GET",
      cookies: { "town-token": "town_session_validtoken" },
    });
    const res = await meGET(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { email: string } };
    expect(body.user.email).toBe("test@example.com");
  });

  it("returns 401 when backend rejects token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "https://town.local/problems/unauthenticated",
          title: "Authentication required",
          status: 401,
          detail: "The session is invalid.",
          code: "UNAUTHENTICATED",
        }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const req = makeRequest("/api/auth/me", {
      method: "GET",
      cookies: { "town-token": "town_session_expired" },
    });
    const res = await meGET(req);
    expect(res.status).toBe(401);
  });
});

describe("auth logout route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("clears cookie even without token", async () => {
    const req = makeRequest("/api/auth/logout", {
      method: "POST",
      cookies: {},
    });
    const res = await logoutPOST(req);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).not.toBeNull();
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).toContain("HttpOnly");
  });

  it("calls backend DELETE /v1/me/session and clears cookie", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    const req = makeRequest("/api/auth/logout", {
      method: "POST",
      cookies: { "town-token": "town_session_validtoken" },
    });
    const res = await logoutPOST(req);
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0];
    expect(call).toBeDefined();
    const [calledUrl, calledInit] = call as [string, RequestInit];
    expect(String(calledUrl)).toContain("/v1/me/session");
    expect(calledInit.method).toBe("DELETE");
    expect(calledInit.headers).toMatchObject({
      Authorization: "Bearer town_session_validtoken",
    });
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).not.toBeNull();
    expect(setCookie).toContain("Max-Age=0");
  });

  it("clears cookie even when backend fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), {
        status: 401,
      }),
    );
    const req = makeRequest("/api/auth/logout", {
      method: "POST",
      cookies: { "town-token": "town_session_expired" },
    });
    const res = await logoutPOST(req);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).not.toBeNull();
    expect(setCookie).toContain("Max-Age=0");
  });
});
