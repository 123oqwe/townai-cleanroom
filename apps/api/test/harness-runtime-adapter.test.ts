import { describe, expect, it, vi } from "vitest";

import { asId } from "@town/contracts";
import { createHarnessRuntimeAdapter } from "../src/harness-runtime-adapter.js";
import type { AppServer, PersistentThreadStore } from "@town/harness";
import type { RuntimeAdapterContext } from "@town/runtime";

const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");
const threadId = asId<"thread">("01900000-0000-7000-8000-000000000002");
const runId = asId<"session-run">("01900000-0000-7000-8000-000000000003");
const turnId = asId<"thread-turn">("01900000-0000-7000-8000-000000000004");

describe("harness runtime adapter", () => {
  it("bridges a persisted triggering turn to assistant output events", async () => {
    const set = vi.fn(async () => undefined);
    const store = {
      get: vi.fn(async () => undefined),
      set,
    } as unknown as PersistentThreadStore;
    const server = {
      dispatch: vi
        .fn()
        .mockResolvedValueOnce({ jsonrpc: "2.0", id: "runtime-initialize" })
        .mockResolvedValueOnce({
          jsonrpc: "2.0",
          id: runId,
          notifications: [
            {
              jsonrpc: "2.0",
              method: "item/completed",
              params: { item: { type: "assistant_message", text: "Done." } },
            },
          ],
        }),
    } as unknown as AppServer;
    const adapter = createHarnessRuntimeAdapter({
      createServer: async () => server,
      createStore: () => store,
      turns: {
        get: vi.fn(async () => ({ text: "Run this" })),
      } as never,
    });

    const events: unknown[] = [];
    for await (const event of adapter.execute({
      session: { ownerId, threadId },
      run: { id: runId, triggeringTurnId: turnId },
      signal: new AbortController().signal,
    } as unknown as RuntimeAdapterContext)) {
      events.push(event);
    }

    expect(set).toHaveBeenCalledOnce();
    expect(server.dispatch).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      { type: "phase", phase: "context_building" },
      { type: "phase", phase: "model_running" },
      { type: "assistant_output", text: "Done.", mentions: [] },
      { type: "phase", phase: "observation_recorded" },
    ]);
  });
});
