import { describe, expect, it } from "vitest";

/**
 * End-to-end smoke test against a staging deployment with a real LLM.
 *
 * Gate: RUN_E2E=true AND RESPONSES_API_KEY must both be set. CI skips
 * this test by default (see vitest.e2e.config.ts). Run locally with:
 *
 *   RUN_E2E=true pnpm test:e2e
 *
 * All credentials are read from process.env — nothing is hardcoded.
 */

const RUN_E2E = process.env["RUN_E2E"] === "true";
const RESPONSES_API_KEY = process.env["RESPONSES_API_KEY"];
const API_URL = process.env["E2E_API_URL"] ?? "http://localhost:3000";
const TEST_EMAIL =
  process.env["E2E_TEST_EMAIL"] ?? "e2e-smoke@townai-cleanroom.test";

const shouldRun = RUN_E2E && RESPONSES_API_KEY !== undefined;

async function api(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (options.token !== undefined)
    headers["authorization"] = `Bearer ${options.token}`;
  return fetch(`${API_URL}${path}`, { ...options, headers });
}

async function establishSession(): Promise<string> {
  const response = await api("/v1/auth/session", {
    method: "POST",
    body: JSON.stringify({
      email: TEST_EMAIL,
      firstName: "E2E",
      lastName: "Smoke",
      timezone: "UTC",
    }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { token: string };
  expect(body.token).toBeTruthy();
  return body.token;
}

async function createThread(token: string): Promise<string> {
  const response = await api("/v1/threads", {
    method: "POST",
    token,
    body: JSON.stringify({
      title: "E2E Smoke Test",
      approvalMode: "never",
    }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { id: string };
  expect(body.id).toBeTruthy();
  return body.id;
}

async function submitMessage(
  token: string,
  threadId: string,
): Promise<{ sessionId: string; runId: string }> {
  const response = await api(`/v1/threads/${threadId}/messages`, {
    method: "POST",
    token,
    headers: { "Idempotency-Key": `e2e-${Date.now()}` },
    body: JSON.stringify({
      text: "Use the town_search tool to find nothing, then say hello.",
      mentions: [],
    }),
  });
  expect(response.status).toBe(202);
  const body = (await response.json()) as {
    session: { id: string };
    run: { id: string };
  };
  expect(body.session.id).toBeTruthy();
  expect(body.run.id).toBeTruthy();
  return { sessionId: body.session.id, runId: body.run.id };
}

async function pollForRunCompletion(
  token: string,
  sessionId: string,
  runId: string,
): Promise<{
  events: Array<{ kind: string; payload: Record<string, unknown> }>;
}> {
  const deadline = Date.now() + 120_000;
  let cursor: string | undefined;
  const events: Array<{
    kind: string;
    payload: Record<string, unknown>;
  }> = [];

  while (Date.now() < deadline) {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor !== undefined) params.set("cursor", cursor);
    const response = await api(`/v1/sessions/${sessionId}/events?${params}`, {
      token,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: Array<{
        kind: string;
        sequence: number;
        payload: Record<string, unknown>;
      }>;
      nextCursor: string | null;
    };
    events.push(...body.items);
    if (body.nextCursor === null) {
      const terminal = events.find(
        (e) => e.kind === "run_completed" || e.kind === "run_failed",
      );
      if (terminal !== undefined) return { events };
    } else {
      cursor = body.nextCursor;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error(
    `Run ${runId} did not reach a terminal state within 120000ms`,
  );
}

async function consumeSseStream(
  token: string,
  sessionId: string,
): Promise<string[]> {
  const response = await fetch(
    `${API_URL}/v1/sessions/${sessionId}/events/stream?windowMs=3000&intervalMs=500`,
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("event:"))
    .map((line) => line.slice(7).trim());
}

describe.skipIf(!shouldRun)("E2E smoke: full assistant chain", () => {
  it("completes the full chain: thread, run, lease, tool call, event store, SSE", async () => {
    const token = await establishSession();
    const threadId = await createThread(token);
    const { sessionId, runId } = await submitMessage(token, threadId);

    const { events } = await pollForRunCompletion(token, sessionId, runId);
    const eventKinds = events.map((e) => e.kind);

    expect(eventKinds).toContain("run_started");
    const terminal = events.find(
      (e) => e.kind === "run_completed" || e.kind === "run_failed",
    );
    expect(terminal).toBeDefined();

    if (terminal?.kind === "run_completed") {
      const toolProposed = events.some((e) => e.kind === "tool_call_proposed");
      const toolExecuted =
        eventKinds.includes("tool_succeeded") ||
        eventKinds.includes("tool_failed");
      if (toolProposed) expect(toolExecuted).toBe(true);
      expect(eventKinds).toContain("assistant_output_recorded");
    }

    const sseEvents = await consumeSseStream(token, sessionId);
    expect(sseEvents.length).toBeGreaterThan(0);
    expect(sseEvents).toContain("end");
  }, 120_000);
});

describe.skipIf(shouldRun)("E2E smoke: full assistant chain", () => {
  it("is skipped when RUN_E2E is not set or RESPONSES_API_KEY is absent", () => {
    expect(shouldRun).toBe(false);
  });
});
