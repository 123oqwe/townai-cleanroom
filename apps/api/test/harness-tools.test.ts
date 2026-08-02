import { describe, expect, it, vi } from "vitest";

import { newId } from "@town/contracts";
import type {
  KnowledgeSearchRepository,
  MemoryRepository,
} from "@town/knowledge";
import {
  createTownMemoryAddHarnessBinding,
  createTownSearchHarnessBinding,
} from "../src/harness-tools.js";

describe("Town Harness built-in tools", () => {
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
});
