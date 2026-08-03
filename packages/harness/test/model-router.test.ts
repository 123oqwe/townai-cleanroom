import { describe, expect, it, vi } from "vitest";

import { createModelRouter, type ModelPort } from "../src/index.js";

function model(result: Awaited<ReturnType<ModelPort["respond"]>>): ModelPort {
  return { respond: vi.fn().mockResolvedValue(result) };
}

describe("model router", () => {
  it("selects enabled routes by priority and reports the selected metadata", async () => {
    const selected: string[] = [];
    const primary = model({ kind: "final", text: "primary" });
    const fallback = model({ kind: "final", text: "fallback" });
    const router = createModelRouter({
      routes: [
        {
          id: "fallback",
          operation: "interactive",
          provider: "provider-b",
          model: "model-b",
          priority: 20,
          port: fallback,
        },
        {
          id: "primary",
          operation: "interactive",
          provider: "provider-a",
          model: "model-a",
          priority: 10,
          port: primary,
        },
      ],
      onSelection: (selection) => {
        selected.push(selection.routeId);
      },
    });

    await expect(
      router.model("interactive").respond({ items: [] }),
    ).resolves.toEqual({
      kind: "final",
      text: "primary",
    });
    expect(selected).toEqual(["primary"]);
    expect(router.routes("interactive").map((route) => route.id)).toEqual([
      "primary",
      "fallback",
    ]);
    expect(fallback.respond).not.toHaveBeenCalled();
  });

  it("falls back only after a provider rejection and preserves the successful result", async () => {
    const selected: Array<{ routeId: string; attempt: number }> = [];
    const primary: ModelPort = {
      respond: vi.fn().mockRejectedValue(new Error("provider unavailable")),
    };
    const fallback = model({
      kind: "tool_call",
      callId: "c1",
      toolName: "town_search",
      arguments: {},
    });
    const router = createModelRouter({
      routes: [
        {
          id: "primary",
          operation: "routine",
          provider: "provider-a",
          model: "model-a",
          priority: 1,
          port: primary,
        },
        {
          id: "fallback",
          operation: "routine",
          provider: "provider-b",
          model: "model-b",
          priority: 2,
          port: fallback,
        },
      ],
      onSelection: (selection) => {
        selected.push({
          routeId: selection.routeId,
          attempt: selection.attempt,
        });
      },
    });

    await expect(
      router.model("routine").respond({ items: [] }),
    ).resolves.toMatchObject({
      kind: "tool_call",
      callId: "c1",
    });
    expect(selected).toEqual([
      { routeId: "primary", attempt: 1 },
      { routeId: "fallback", attempt: 2 },
    ]);
  });

  it("fails explicitly when an operation has no enabled route", async () => {
    const router = createModelRouter({
      routes: [
        {
          id: "disabled",
          operation: "compaction",
          provider: "provider-a",
          model: "model-a",
          priority: 1,
          enabled: false,
          port: model({ kind: "final", text: "never" }),
        },
      ],
    });

    await expect(
      router.model("compaction").respond({ items: [] }),
    ).rejects.toThrow("HARNESS_MODEL_ROUTE_UNAVAILABLE");
  });
});
