import { describe, expect, it, vi } from "vitest";

import { newId } from "@town/contracts";
import type { ToolDefinition } from "@town/tools";
import type {
  KnowledgeSearchRepository,
  MemoryRepository,
} from "@town/knowledge";
import {
  createInvokeRoutineHarnessBinding,
  createRegistryHarnessBindings,
  createTownMemoryAddHarnessBinding,
  createTownSearchHarnessBinding,
  createGoogleCalendarCreateEventHarnessBinding,
  createGoogleGmailSendHarnessBinding,
  createMcpHarnessBindings,
} from "../src/harness-tools.js";
import { AgentError } from "@town/agents";
import type { AgentRepository, RoutineAgent } from "@town/agents";
import type { SessionRepository } from "@town/runtime";
import type { ThreadRepository } from "@town/agents";

describe("Town Harness built-in tools", () => {
  it("exposes discovered MCP tools only through the policy-aware port", async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "remote result" }],
    });
    const [binding] = createMcpHarnessBindings({
      client: { callTool },
      serverName: "Research Server",
      modeOverride: null,
      tools: [
        {
          name: "search",
          description: "Search remote data",
          inputSchema: { type: "object" },
          annotations: { readOnlyHint: true },
        },
      ],
    });
    if (binding === undefined) throw new Error("Expected MCP binding.");
    expect(binding.definition.name).toBe("mcp_Research_Server_search");
    await expect(
      binding.port.execute({ query: "town" }),
    ).resolves.toMatchObject({ kind: "result" });
    expect(callTool).toHaveBeenCalledWith("search", { query: "town" });
  });

  it("requires approval for MCP tools without a read-only hint", async () => {
    const callTool = vi.fn().mockResolvedValue({ ok: true });
    const [binding] = createMcpHarnessBindings({
      client: { callTool },
      serverName: "Writer",
      modeOverride: null,
      tools: [{ name: "write", inputSchema: { type: "object" } }],
    });
    if (binding === undefined) throw new Error("Expected MCP binding.");
    await expect(binding.port.execute({ value: "x" })).rejects.toThrow(
      "HARNESS_TOOL_APPROVAL_REQUIRED",
    );
    expect(callTool).not.toHaveBeenCalled();
    await expect(
      binding.port.execute(
        { value: "x" },
        { approvalGranted: true, policyDecision: "approval_required" },
      ),
    ).resolves.toMatchObject({ kind: "result" });
  });

  it("records an approved MCP call through durable ToolCall transitions", async () => {
    const ownerId = newId<"user">();
    const toolDefinitionId = newId<"tool-definition">();
    const callId = newId<"tool-call">();
    const execution = {
      propose: vi.fn().mockResolvedValue({
        toolCall: { id: callId, status: "approved" },
      }),
      start: vi.fn().mockResolvedValue(undefined),
      succeed: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
    };
    const callTool = vi.fn().mockResolvedValue({ ok: true });
    const [binding] = createMcpHarnessBindings({
      client: { callTool },
      serverName: "Writer",
      modeOverride: null,
      tools: [{ name: "write", inputSchema: { type: "object" } }],
      durable: {
        execution: execution as never,
        ownerId,
        sessionId: newId<"runtime-session">(),
        runId: newId<"session-run">(),
        leaseToken: "lease-token",
        agentVersionId: newId<"agent-version">(),
        toolDefinitionIds: new Map([["mcp_Writer_write", toolDefinitionId]]),
      },
    });
    if (binding === undefined) throw new Error("Expected MCP binding.");
    await binding.port.execute(
      { value: "x" },
      {
        approvalGranted: true,
        policyDecision: "approval_required",
        callId: "model-call-1",
      },
    );
    expect(execution.propose).toHaveBeenCalledWith(
      expect.objectContaining({
        toolDefinitionId,
        approvalGranted: true,
        idempotencyKey: "harness:model-call-1",
      }),
    );
    expect(execution.start).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallId: callId }),
    );
    expect(execution.succeed).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallId: callId }),
    );
    expect(execution.fail).not.toHaveBeenCalled();
  });
  it("binds owner-scoped knowledge search with a typed JSON result", async () => {
    const ownerId = newId<"user">();
    const search = {
      search: vi.fn().mockResolvedValue({
        items: [
          {
            resourceType: "memory",
            resourceId: newId<"memory">(),
            text: "a reliable result",
          },
        ],
        nextCursor: "cursor-1",
      }),
    };
    const binding = createTownSearchHarnessBinding(ownerId, search);

    expect(binding.definition.name).toBe("town_search");
    expect(binding.port.requiresApproval).toBe(false);
    const result = await binding.port.execute({
      query: "launch",
      limit: 5,
      cursor: "cursor-0",
    });
    expect(result.kind).toBe("result");
    expect(JSON.parse(result.output)).toMatchObject({
      nextCursor: "cursor-1",
      truncated: false,
    });
    expect(search.search).toHaveBeenCalledWith({
      ownerId,
      query: "launch",
      limit: 5,
      cursor: "cursor-0",
    });
  });

  it("rejects malformed or extra arguments before touching the repository", async () => {
    const search = { search: vi.fn() };
    const binding = createTownSearchHarnessBinding(newId<"user">(), search);
    await expect(
      binding.port.execute({ query: "", unexpected: true }),
    ).rejects.toThrow();
    expect(search.search).not.toHaveBeenCalled();
  });

  it("rejects duplicate, empty, and oversized type filters", async () => {
    const search = { search: vi.fn() };
    const binding = createTownSearchHarnessBinding(newId<"user">(), search);
    await expect(
      binding.port.execute({ query: "x", types: ["memory", "memory"] }),
    ).rejects.toThrow();
    await expect(
      binding.port.execute({ query: "x", types: [] }),
    ).rejects.toThrow();
    await expect(
      binding.port.execute({
        query: "x",
        types: [
          "memory",
          "person",
          "profile",
          "wiki",
          "memory",
          "person",
          "profile",
          "wiki",
          "memory",
        ],
      }),
    ).rejects.toThrow();
    expect(search.search).not.toHaveBeenCalled();
  });

  it("caps serialized knowledge text before it reaches the model", async () => {
    const search = {
      search: vi.fn().mockResolvedValue({
        items: [
          {
            resourceType: "wiki",
            resourceId: newId<"wiki">(),
            text: "x".repeat(100_000),
            citations: [],
          },
        ],
        nextCursor: null,
      }),
    };
    const binding = createTownSearchHarnessBinding(newId<"user">(), search);
    const result = await binding.port.execute({ query: "large" });
    expect(result.output.length).toBeLessThanOrEqual(12_000);
    expect(JSON.parse(result.output).truncated).toBe(true);
  });

  it("shrinks the repository page before returning a cursor", async () => {
    const allItems = Array.from({ length: 10 }, (_, index) => ({
      resourceType: "wiki",
      resourceId: newId<"wiki">(),
      text: `${index}`.repeat(1_500),
      citations: [],
    }));
    const searchMock = vi.fn(async ({ limit = 10 }: { limit?: number }) => ({
      items: allItems.slice(0, limit),
      nextCursor: `cursor-after-${limit}`,
    }));
    const search = {
      search: searchMock,
    } as unknown as KnowledgeSearchRepository;
    const binding = createTownSearchHarnessBinding(newId<"user">(), search);
    const result = await binding.port.execute({ query: "paged", limit: 10 });
    const output = JSON.parse(result.output) as {
      items: unknown[];
      nextCursor: string | null;
    };
    expect(searchMock.mock.calls.map(([input]) => input.limit)).toEqual([
      10, 5,
    ]);
    expect(output.items).toHaveLength(5);
    expect(output.nextCursor).toBe("cursor-after-5");
  });

  it("requires approval before creating a durable memory", async () => {
    const memoryCreate = vi.fn().mockResolvedValue({
      id: newId<"memory">(),
      scope: "global",
      routineId: null,
      status: "active",
      confidence: null,
      createdAt: new Date("2026-08-02T00:00:00Z"),
    });
    const memory = { create: memoryCreate } as unknown as MemoryRepository;
    const ownerId = newId<"user">();
    const ownsSchedule = vi.fn().mockResolvedValue(true);
    const binding = createTownMemoryAddHarnessBinding(
      ownerId,
      memory,
      "thread-123",
      ownsSchedule,
    );
    expect(typeof binding.port.requiresApproval).toBe("function");
    expect(
      (
        binding.port.requiresApproval as (
          args: Record<string, unknown>,
        ) => string
      )({
        scope: "global",
        content: "fact",
      }),
    ).toBe("approval_required");
    await expect(
      binding.port.execute({ scope: "global", content: "fact" }),
    ).rejects.toThrow("HARNESS_TOOL_APPROVAL_REQUIRED");
    expect(memoryCreate).not.toHaveBeenCalled();
    await expect(
      binding.port.execute(
        { scope: "global", content: "fact" },
        { approvalGranted: true, policyDecision: "approval_required" },
      ),
    ).resolves.toMatchObject({ kind: "result" });
    expect(memoryCreate).toHaveBeenCalledTimes(1);
    expect(memoryCreate.mock.calls[0]?.[0].citations[0].sourceRef).toBe(
      "harness:thread-123:town_memory_add",
    );
    expect(ownsSchedule).not.toHaveBeenCalled();
  });

  it("requires an owned active routine for routine-scoped memory", async () => {
    const memoryCreate = vi.fn();
    const ownsSchedule = vi.fn().mockResolvedValue(false);
    const binding = createTownMemoryAddHarnessBinding(
      newId<"user">(),
      { create: memoryCreate } as unknown as MemoryRepository,
      "thread-456",
      ownsSchedule,
    );
    const routineId = newId<"routine-schedule">();
    await expect(
      binding.port.execute(
        { scope: "routine", routineId, content: "fact" },
        { approvalGranted: true, policyDecision: "approval_required" },
      ),
    ).rejects.toThrow("HARNESS_MEMORY_ROUTINE_NOT_FOUND");
    expect(memoryCreate).not.toHaveBeenCalled();
    expect(ownsSchedule).toHaveBeenCalledWith(expect.any(String), routineId);
    expect(
      (
        binding.port.requiresApproval as (
          args: Record<string, unknown>,
        ) => string
      )({
        scope: "global",
        routineId,
        content: "fact",
      }),
    ).toBe("deny");
  });

  it("wires only owner-scoped registry definitions with explicit handlers", async () => {
    const ownerId = newId<"user">();
    const definition: ToolDefinition & {
      binding: import("@town/tools").AgentToolBinding;
    } = {
      id: newId<"tool-definition">(),
      ownerId,
      name: "registry_read",
      version: 1,
      description: "A registry read tool",
      inputSchema: { type: "object" },
      outputSchema: null,
      sideEffect: "read",
      dataSensitivity: "private",
      accountBinding: "none",
      enabled: true,
      createdAt: new Date("2026-08-02T00:00:00Z"),
      binding: {
        id: newId<"agent-tool-binding">(),
        ownerId,
        agentVersionId: newId<"agent-version">(),
        toolDefinitionId: newId<"tool-definition">(),
        modeOverride: null,
        accountScope: [],
        createdAt: new Date("2026-08-02T00:00:00Z"),
      },
    };
    const handler = vi
      .fn()
      .mockResolvedValue({ kind: "result", output: "real" });
    const bindings = createRegistryHarnessBindings({
      ownerId,
      threadId: "thread-registry",
      definitions: [definition],
      handlers: new Map([[definition.name, handler]]),
    });

    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.definition.name).toBe("registry_read");
    expect(
      (
        bindings[0]?.port.requiresApproval as (
          args: Record<string, unknown>,
        ) => string
      )({}),
    ).toBe("allow");
    await expect(bindings[0]?.port.execute({})).resolves.toEqual({
      kind: "result",
      output: "real",
    });
    expect(handler).toHaveBeenCalledWith({}, { approvalGranted: false });

    const unhandled = createRegistryHarnessBindings({
      ownerId,
      threadId: "thread-registry",
      definitions: [{ ...definition, ownerId: newId<"user">() }],
      handlers: new Map(),
    });
    expect(unhandled).toEqual([]);

    const readOnly = {
      ...definition,
      version: 2,
      sideEffect: "private_write" as const,
      binding: { ...definition.binding, modeOverride: "read_only" as const },
    };
    const denied = createRegistryHarnessBindings({
      ownerId,
      threadId: "thread-registry",
      definitions: [definition, readOnly],
      handlers: new Map([[definition.name, handler]]),
    });
    expect(denied).toHaveLength(1);
    expect(
      (
        denied[0]?.port.requiresApproval as (
          args: Record<string, unknown>,
        ) => string
      )({}),
    ).toBe("deny");
    await expect(denied[0]?.port.execute({})).rejects.toThrow(
      "HARNESS_TOOL_POLICY_DENIED",
    );
  });

  it("queues an allowlisted child routine through the durable session repository", async () => {
    const ownerId = newId<"user">();
    const parentId = newId<"agent">();
    const childId = newId<"agent">();
    const parent = {
      id: parentId,
      activeVersion: { snapshot: { callableRoutineIds: [childId] } },
    } as unknown as RoutineAgent;
    const child = {
      id: childId,
      activeVersion: {
        snapshot: {
          callableRoutineIds: [],
          displayName: "Child",
          defaultApprovalMode: "autonomous",
        },
      },
    } as unknown as RoutineAgent;
    const agents = {
      getPersonal: vi
        .fn()
        .mockRejectedValue(new AgentError("AGENT_NOT_FOUND", "no personal")),
      getRoutine: vi
        .fn()
        .mockResolvedValueOnce(child)
        .mockResolvedValueOnce(parent),
    } as unknown as AgentRepository;
    const threads = {
      get: vi.fn().mockResolvedValue({ agentId: parentId }),
      createTask: vi.fn().mockResolvedValue({ id: newId<"thread">() }),
    } as unknown as ThreadRepository;
    const sessions = {
      submitMessage: vi.fn().mockResolvedValue({
        session: { id: newId<"runtime-session">() },
        run: { id: newId<"session-run">() },
        replayed: false,
      }),
    } as unknown as SessionRepository;
    const binding = createInvokeRoutineHarnessBinding({
      ownerId,
      threadId: "parent-thread",
      agents,
      threads,
      sessions,
    });
    await expect(
      binding.port.execute(
        { routineId: childId, input: "summarize this" },
        { approvalGranted: true, policyDecision: "approval_required" },
      ),
    ).resolves.toMatchObject({ kind: "result" });
    expect(sessions.submitMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: "summarize this" }),
    );
  });

  it("requires approval before creating an external Google Calendar event", async () => {
    const ownerId = newId<"user">();
    const accountId = newId<"connected-account">();
    const google = {
      calendarCreateEvent: vi.fn().mockResolvedValue({ id: "event-1" }),
    };
    const binding = createGoogleCalendarCreateEventHarnessBinding(
      ownerId,
      google as never,
    );
    const arguments_ = { accountId, event: { summary: "Focus" } };
    await expect(binding.port.execute(arguments_)).rejects.toThrow(
      "APPROVAL_REQUIRED",
    );
    await expect(
      binding.port.execute(arguments_, {
        approvalGranted: true,
        policyDecision: "approval_required",
      }),
    ).resolves.toMatchObject({ kind: "result" });
    expect(google.calendarCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId, accountId }),
    );
  });

  it("requires approval before sending an external Gmail message", async () => {
    const ownerId = newId<"user">();
    const accountId = newId<"connected-account">();
    const google = { gmailSend: vi.fn().mockResolvedValue({ id: "sent-1" }) };
    const binding = createGoogleGmailSendHarnessBinding(
      ownerId,
      google as never,
    );
    const arguments_ = {
      accountId,
      to: "recipient@example.invalid",
      subject: "Hello",
      body: "Body",
    };
    await expect(binding.port.execute(arguments_)).rejects.toThrow(
      "APPROVAL_REQUIRED",
    );
    await expect(
      binding.port.execute(arguments_, {
        approvalGranted: true,
        policyDecision: "approval_required",
      }),
    ).resolves.toMatchObject({ kind: "result" });
    expect(google.gmailSend).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId, accountId }),
    );
  });
});
