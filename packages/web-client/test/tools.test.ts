import { describe, expect, it, vi } from "vitest";

import { newId } from "@town/contracts";

import { TownClient } from "../src/index.js";

type FetchCall = {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
};

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  const status = init.status ?? 200;
  if (body === null || status === 204) return new Response(null, { status });
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeClient(
  responses: Response[],
  calls: FetchCall[],
  options: { token?: string } = {},
): TownClient {
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({
      url,
      init: {
        ...init,
        headers: (init.headers ?? {}) as Record<string, string>,
      },
    });
    const response = responses.shift();
    if (response === undefined) throw new Error("no mock response queued");
    return response;
  }) as unknown as typeof globalThis.fetch;
  return new TownClient({
    baseUrl: "https://api.example.test",
    ...(options.token === undefined ? {} : { token: options.token }),
    fetch: fetchImpl,
  });
}

describe("TownClient tools namespace", () => {
  it("lists tools via GET /v1/tools", async () => {
    const calls: FetchCall[] = [];
    const client = makeClient(
      [
        jsonResponse({
          tools: [
            {
              id: "send-email",
              name: "send_email",
              description: "Send an email",
              enabled: true,
              sideEffect: true,
              dataSensitivity: "medium",
            },
          ],
        }),
      ],
      calls,
      { token: "t" },
    );

    const tools = await client.tools.list();

    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("send_email");
    expect(tools[0]?.sideEffect).toBe(true);
  });

  it("evaluates tool policy via POST /v1/tools/policy/evaluate", async () => {
    const calls: FetchCall[] = [];
    const client = makeClient(
      [
        jsonResponse({
          decision: "allow",
          reason: "No side effects",
          approvalRequired: false,
        }),
      ],
      calls,
      { token: "t" },
    );

    const result = await client.tools.policy.evaluate({
      toolName: "search_web",
      arguments: { query: "test" },
    });

    expect(result.decision).toBe("allow");
    expect(result.approvalRequired).toBe(false);
    expect(calls[0]?.init.method).toBe("POST");
    const body = JSON.parse(calls[0]?.init.body as string);
    expect(body.toolName).toBe("search_web");
  });

  it("gets a tool call via GET /v1/tool-calls/:id", async () => {
    const id = newId<"tool-call">();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [
        jsonResponse({
          toolCall: {
            id,
            ownerId: newId<"user">(),
            name: "send_email",
            status: "completed",
            sideEffect: true,
            dataSensitivity: "medium",
            accountBinding: null,
            arguments: { to: "a@b.com" },
            result: { ok: true },
            errorCode: null,
            createdAt: "2026-08-06T00:00:00.000Z",
            finishedAt: "2026-08-06T00:00:01.000Z",
          },
        }),
      ],
      calls,
      { token: "t" },
    );

    const call = await client.tools.calls.get(id);

    expect(call.name).toBe("send_email");
    expect(call.status).toBe("completed");
    expect(calls[0]?.url).toContain(`/v1/tool-calls/${id}`);
  });
});
