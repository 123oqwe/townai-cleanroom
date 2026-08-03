import { describe, expect, it, vi } from "vitest";

import { McpClientError, createMcpClient } from "../src/index.js";

function jsonResponse(value: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("MCP HTTP clients", () => {
  it("initializes streamable HTTP, persists the session id, lists and calls tools", async () => {
    const fetcher = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            jsonrpc: "2.0",
            id: 1,
            result: {
              protocolVersion: "2025-11-25",
              capabilities: { tools: {} },
              serverInfo: { name: "fixture", version: "1" },
            },
          },
          { "mcp-session-id": "session-1" },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: "2.0",
          id: 2,
          result: {
            tools: [
              {
                name: "echo",
                description: "Echo input",
                inputSchema: { type: "object" },
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: "2.0",
          id: 3,
          result: { content: [{ type: "text", text: "ok" }] },
        }),
      );
    const client = createMcpClient(
      { url: "https://mcp.example.invalid/mcp", transport: "streamable_http" },
      { fetch: fetcher },
    );
    await expect(client.initialize()).resolves.toMatchObject({
      protocolVersion: "2025-11-25",
    });
    await expect(client.listTools()).resolves.toMatchObject({
      tools: [{ name: "echo" }],
    });
    await expect(client.callTool("echo", { value: "hello" })).resolves.toEqual({
      content: [{ type: "text", text: "ok" }],
    });
    const calls = fetcher.mock.calls;
    expect(calls[2]?.[1]?.headers).toMatchObject({
      "mcp-session-id": "session-1",
      "mcp-method": "tools/list",
    });
    expect(calls[3]?.[1]?.body).toContain('"name":"echo"');
  });

  it("discovers the legacy SSE POST endpoint", async () => {
    const fetcher = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response("event: endpoint\ndata: /messages\n\n", {
          headers: { "content-type": "text/event-stream" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: "2.0",
          id: 1,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            serverInfo: { name: "legacy", version: "1" },
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    const client = createMcpClient(
      { url: "https://mcp.example.invalid/sse", transport: "sse" },
      { fetch: fetcher },
    );
    await expect(client.initialize()).resolves.toMatchObject({
      serverInfo: { name: "legacy" },
    });
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe("GET");
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "https://mcp.example.invalid/messages",
    );
  });

  it("rejects calls before initialization and invalid URLs", async () => {
    expect(() =>
      createMcpClient({ url: "file:///tmp/mcp", transport: "sse" }),
    ).toThrowError(McpClientError);
    const client = createMcpClient({
      url: "https://mcp.example.invalid",
      transport: "streamable_http",
    });
    await expect(client.listTools()).rejects.toMatchObject({
      code: "MCP_NOT_INITIALIZED",
    });
  });
});
