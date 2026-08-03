import { z } from "zod";

import { mcpTransportSchema, type McpServer } from "./mcp-repository.js";

const jsonRpcResponseSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number()]).optional(),
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.unknown().optional(),
      })
      .optional(),
  })
  .strict();

const toolSchema = z
  .object({
    name: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    inputSchema: z.record(z.string(), z.json()),
    outputSchema: z.record(z.string(), z.json()).optional(),
    annotations: z.record(z.string(), z.json()).optional(),
    execution: z.record(z.string(), z.json()).optional(),
  })
  .passthrough();

const initializeResultSchema = z
  .object({
    protocolVersion: z.string(),
    capabilities: z.record(z.string(), z.json()),
    serverInfo: z.record(z.string(), z.json()),
    instructions: z.string().optional(),
  })
  .passthrough();

const toolsListResultSchema = z
  .object({
    tools: z.array(toolSchema),
    nextCursor: z.string().optional(),
  })
  .strict();

export interface McpRemoteTool {
  name: string;
  title?: string | undefined;
  description?: string | undefined;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown> | undefined;
  annotations?: Record<string, unknown> | undefined;
  execution?: Record<string, unknown> | undefined;
}

export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo: Record<string, unknown>;
  instructions?: string | undefined;
}

export interface McpClientOptions {
  fetch?: typeof globalThis.fetch;
  headers?: Record<string, string>;
  timeoutMs?: number;
  clientName?: string;
  clientVersion?: string;
}

export class McpClientError extends Error {
  constructor(
    readonly code:
      | "MCP_INVALID_URL"
      | "MCP_TIMEOUT"
      | "MCP_HTTP_ERROR"
      | "MCP_PROTOCOL_ERROR"
      | "MCP_REMOTE_ERROR"
      | "MCP_NOT_INITIALIZED",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "McpClientError";
  }
}

type JsonRpcId = number;

function parseJsonRpc(value: unknown): z.infer<typeof jsonRpcResponseSchema> {
  const parsed = jsonRpcResponseSchema.safeParse(value);
  if (!parsed.success)
    throw new McpClientError(
      "MCP_PROTOCOL_ERROR",
      "The MCP server returned an invalid JSON-RPC response.",
      { cause: parsed.error },
    );
  if (parsed.data.error !== undefined)
    throw new McpClientError(
      "MCP_REMOTE_ERROR",
      `The MCP server rejected the request (${parsed.data.error.code}): ${parsed.data.error.message}`,
    );
  return parsed.data;
}

function parseSseData(text: string): unknown {
  const data = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .find((line) => line.length > 0);
  if (data === undefined)
    throw new McpClientError(
      "MCP_PROTOCOL_ERROR",
      "The MCP SSE response did not contain a data event.",
    );
  try {
    return JSON.parse(data) as unknown;
  } catch (error) {
    throw new McpClientError(
      "MCP_PROTOCOL_ERROR",
      "The MCP SSE response contained invalid JSON.",
      { cause: error },
    );
  }
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function createMcpClient(
  server: Pick<McpServer, "url" | "transport">,
  options: McpClientOptions = {},
) {
  if (!isAbsoluteHttpUrl(server.url))
    throw new McpClientError(
      "MCP_INVALID_URL",
      "MCP server URL must use HTTP(S).",
    );
  const fetcher = options.fetch ?? globalThis.fetch;
  const transport = mcpTransportSchema.parse(server.transport);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const headers = { ...(options.headers ?? {}) };
  let nextId: JsonRpcId = 1;
  let sessionId: string | undefined;
  let initialized = false;
  let legacyEndpoint: string | undefined;

  async function fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetcher(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError")
        throw new McpClientError("MCP_TIMEOUT", "The MCP request timed out.", {
          cause: error,
        });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function readResponse(response: Response): Promise<unknown> {
    if (!response.ok)
      throw new McpClientError(
        "MCP_HTTP_ERROR",
        `The MCP server returned HTTP ${response.status}.`,
      );
    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    if (contentType.includes("text/event-stream")) return parseSseData(text);
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new McpClientError(
        "MCP_PROTOCOL_ERROR",
        "The MCP server returned a non-JSON response.",
        { cause: error },
      );
    }
  }

  async function establishLegacyEndpoint(): Promise<void> {
    const response = await fetchWithTimeout(server.url, {
      method: "GET",
      headers: {
        ...headers,
        accept: "text/event-stream",
      },
    });
    if (!response.ok)
      throw new McpClientError(
        "MCP_HTTP_ERROR",
        `The MCP SSE endpoint returned HTTP ${response.status}.`,
      );
    const text = await response.text();
    const endpointLine = text
      .split(/\r?\n/)
      .find((line) => line.startsWith("data:") && line.includes("/"));
    if (endpointLine === undefined)
      throw new McpClientError(
        "MCP_PROTOCOL_ERROR",
        "The MCP SSE endpoint did not announce a POST endpoint.",
      );
    const endpoint = endpointLine.slice(5).trim();
    const resolved = new URL(endpoint, server.url).toString();
    if (!isAbsoluteHttpUrl(resolved))
      throw new McpClientError(
        "MCP_PROTOCOL_ERROR",
        "The MCP endpoint URL is invalid.",
      );
    legacyEndpoint = resolved;
  }

  async function request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (transport === "sse" && legacyEndpoint === undefined)
      await establishLegacyEndpoint();
    const url = legacyEndpoint ?? server.url;
    const id = nextId++;
    const requestHeaders: Record<string, string> = {
      ...headers,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25",
      "mcp-method": method,
    };
    if (sessionId !== undefined) requestHeaders["mcp-session-id"] = sessionId;
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    const returnedSessionId = response.headers.get("mcp-session-id");
    if (returnedSessionId !== null) sessionId = returnedSessionId;
    const value = parseJsonRpc(await readResponse(response));
    if (value.id !== undefined && value.id !== id)
      throw new McpClientError(
        "MCP_PROTOCOL_ERROR",
        "The MCP response id did not match the request.",
      );
    return value.result;
  }

  async function initialize(): Promise<McpInitializeResult> {
    const result = initializeResultSchema.parse(
      await request("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: {
          name: options.clientName ?? "town-cleanroom",
          version: options.clientVersion ?? "0.0.0",
        },
      }),
    );
    initialized = true;
    // Notifications do not require a response; send them through the same
    // transport so stateful servers can finish their initialization handshake.
    const url = legacyEndpoint ?? server.url;
    const notificationHeaders: Record<string, string> = {
      ...headers,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25",
      "mcp-method": "notifications/initialized",
    };
    if (sessionId !== undefined)
      notificationHeaders["mcp-session-id"] = sessionId;
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: notificationHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
    if (!response.ok)
      throw new McpClientError(
        "MCP_HTTP_ERROR",
        `The MCP initialization notification returned HTTP ${response.status}.`,
      );
    return result;
  }

  async function listTools(
    cursor?: string,
  ): Promise<{ tools: McpRemoteTool[]; nextCursor: string | null }> {
    if (!initialized)
      throw new McpClientError(
        "MCP_NOT_INITIALIZED",
        "Initialize the MCP client before listing tools.",
      );
    const result = toolsListResultSchema.parse(
      await request("tools/list", cursor === undefined ? {} : { cursor }),
    );
    return { tools: result.tools, nextCursor: result.nextCursor ?? null };
  }

  async function callTool(
    name: string,
    argumentsValue: Record<string, unknown>,
  ): Promise<unknown> {
    if (!initialized)
      throw new McpClientError(
        "MCP_NOT_INITIALIZED",
        "Initialize the MCP client before calling tools.",
      );
    if (!z.string().min(1).safeParse(name).success)
      throw new McpClientError(
        "MCP_PROTOCOL_ERROR",
        "MCP tool name must not be empty.",
      );
    return request("tools/call", { name, arguments: argumentsValue });
  }

  return { initialize, listTools, callTool };
}

export type McpClient = ReturnType<typeof createMcpClient>;
