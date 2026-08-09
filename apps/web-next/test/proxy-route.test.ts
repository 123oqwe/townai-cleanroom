import { describe, expect, it, vi, beforeEach } from "vitest";

process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:3000";

import {
  GET as proxyGET,
  POST as proxyPOST,
} from "../app/api/proxy/[...path]/route";

function makeProxyRequest(
  method: string,
  pathSegments: string[],
  options: {
    cookies?: Record<string, string>;
    search?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) {
  const search = options.search ?? "";
  const pathStr = pathSegments.join("/");
  const url = `http://localhost:3001/${pathStr}${search}`;
  const headers: Record<string, string> = { ...options.headers };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const req = new Request(url, {
    method,
    headers,
    ...(options.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {}),
  });
  const nextUrl = new URL(url);
  const nextReq = req as unknown as {
    cookies: {
      get: (name: string) => { value: string } | undefined;
    };
    headers: Headers;
    method: string;
    nextUrl: URL;
    text: () => Promise<string>;
  };
  nextReq.nextUrl = nextUrl;
  const cookies = options.cookies ?? {};
  nextReq.cookies = {
    get: (name: string) => {
      const value = cookies[name];
      return value === undefined ? undefined : { value };
    },
  };
  return {
    req: nextReq as unknown as Parameters<typeof proxyGET>[0],
    params: Promise.resolve({ path: pathSegments }),
  };
}

describe("proxy route — authentication", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 401 when no cookie present", async () => {
    const { req, params } = makeProxyRequest("GET", ["v1", "me"]);
    const res = await proxyGET(req, { params });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("returns 401 when cookie is empty string", async () => {
    const { req, params } = makeProxyRequest("GET", ["v1", "me"], {
      cookies: { "town-token": "" },
    });
    const res = await proxyGET(req, { params });
    expect(res.status).toBe(401);
  });
});

describe("proxy route — request forwarding", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards GET with Bearer token to backend", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const { req, params } = makeProxyRequest("GET", ["v1", "threads"], {
      cookies: { "town-token": "town_session_testtoken" },
      search: "?limit=10",
    });
    const res = await proxyGET(req, { params });
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0];
    expect(call).toBeDefined();
    const [calledUrl, calledInit] = call as [string, RequestInit];
    expect(String(calledUrl)).toBe("http://localhost:3000/v1/threads?limit=10");
    expect(calledInit.method).toBe("GET");
    expect(calledInit.headers).toMatchObject({
      Authorization: "Bearer town_session_testtoken",
    });
  });

  it("forwards POST with body and idempotency key", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "thread_123" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    const { req, params } = makeProxyRequest("POST", ["v1", "threads"], {
      cookies: { "town-token": "town_session_testtoken" },
      body: { title: "Test thread" },
      headers: { "idempotency-key": "abc-123" },
    });
    const res = await proxyPOST(req, { params });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe("thread_123");
    const call = fetchSpy.mock.calls[0];
    expect(call).toBeDefined();
    const [calledUrl, calledInit] = call as [string, RequestInit];
    expect(String(calledUrl)).toBe("http://localhost:3000/v1/threads");
    expect(calledInit.method).toBe("POST");
    expect(calledInit.headers).toMatchObject({
      Authorization: "Bearer town_session_testtoken",
      "idempotency-key": "abc-123",
    });
    expect(calledInit.body).toBe(JSON.stringify({ title: "Test thread" }));
  });

  it("passes through non-2xx status codes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404 }),
    );
    const { req, params } = makeProxyRequest(
      "GET",
      ["v1", "threads", "nonexistent"],
      { cookies: { "town-token": "town_session_testtoken" } },
    );
    const res = await proxyGET(req, { params });
    expect(res.status).toBe(404);
  });
});

describe("proxy route — SSE streaming", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("streams SSE response body directly", async () => {
    const sseData =
      'event: run_started\ndata: {"id":"evt_1"}\n\nevent: end\n\n';
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseData));
        controller.close();
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
    const { req, params } = makeProxyRequest(
      "GET",
      ["v1", "sessions", "sess_1", "events", "stream"],
      { cookies: { "town-token": "town_session_testtoken" } },
    );
    const res = await proxyGET(req, { params });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("event: run_started");
    expect(text).toContain("event: end");
  });
});
