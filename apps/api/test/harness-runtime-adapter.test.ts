import { describe, expect, it, vi } from "vitest";

import { asId } from "@town/contracts";
import { createHarnessRuntimeAdapter } from "../src/harness-runtime-adapter.js";
import type { AppServer, PersistentThreadStore } from "@town/harness";
import { RetryableRuntimeError, type RuntimeAdapterContext } from "@town/runtime";

const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");
const threadId = asId<"thread">("01900000-0000-7000-8000-000000000002");
const runId = asId<"session-run">("01900000-0000-7000-8000-000000000003");
const turnId = asId<"thread-turn">("01900000-0000-7000-8000-000000000004");
const agentVersionId = asId<"agent-version">(
  "01900000-0000-7000-8000-000000000005",
);

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
      session: { ownerId, threadId, agentVersion: { id: agentVersionId } },
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

  it("keeps a pending approval waiting until a durable decision exists", async () => {
    const store = {
      get: vi.fn(async () => ({
        threadId,
        pendingApproval: {
          callId: "approval-1",
          toolName: "google_gmail_send",
          arguments: {},
        },
        items: [],
        stepCount: 1,
        revision: 1,
      })),
      set: vi.fn(async () => undefined),
    } as unknown as PersistentThreadStore;
    const server = { dispatch: vi.fn() } as unknown as AppServer;
    const adapter = createHarnessRuntimeAdapter({
      createServer: async () => server,
      createStore: () => store,
      turns: {} as never,
      approvalDecisions: {
        getPending: vi.fn(async () => null),
        consume: vi.fn(),
      } as never,
    });
    const events: unknown[] = [];
    for await (const event of adapter.execute({
      session: {
        id: "session-1",
        ownerId,
        threadId,
        agentVersion: { id: agentVersionId },
      },
      run: { id: runId, triggeringTurnId: turnId },
      signal: new AbortController().signal,
    } as unknown as RuntimeAdapterContext))
      events.push(event);
    expect(events.at(-1)).toEqual({
      type: "waiting_approval",
      reason: "Approval is required before this durable run can continue.",
      approvalId: "approval-1",
    });
    expect(server.dispatch).not.toHaveBeenCalled();
  });

  it("resolves a persisted approval through the Harness before completing", async () => {
    const store = {
      get: vi.fn(async () => ({
        threadId,
        pendingApproval: {
          callId: "approval-1",
          toolName: "google_gmail_send",
          arguments: {},
        },
        items: [],
        stepCount: 1,
        revision: 1,
      })),
      set: vi.fn(async () => undefined),
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
              params: { item: { type: "assistant_message", text: "Sent." } },
            },
          ],
        }),
    } as unknown as AppServer;
    const decisions = {
      getPending: vi.fn(async () => ({ decision: "approve" })),
      consume: vi.fn(async () => undefined),
    };
    const adapter = createHarnessRuntimeAdapter({
      createServer: async () => server,
      createStore: () => store,
      turns: {} as never,
      approvalDecisions: decisions as never,
    });
    const events: unknown[] = [];
    for await (const event of adapter.execute({
      session: {
        id: "session-1",
        ownerId,
        threadId,
        agentVersion: { id: agentVersionId },
      },
      run: { id: runId, triggeringTurnId: turnId },
      signal: new AbortController().signal,
    } as unknown as RuntimeAdapterContext))
      events.push(event);
    expect(server.dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: "approval/resolve",
        params: { threadId, approvalId: "approval-1", decision: "approve" },
      }),
    );
    expect(decisions.consume).toHaveBeenCalledOnce();
    expect(events).toContainEqual({
      type: "assistant_output",
      text: "Sent.",
      mentions: [],
    });
  });

  it("maps retryable transport failures into the runtime retry classifier", async () => {
    const store = {
      get: vi.fn(async () => ({
        threadId,
        items: [],
        stepCount: 0,
        revision: 0,
      })),
      set: vi.fn(async () => undefined),
    } as unknown as PersistentThreadStore;
    const adapter = createHarnessRuntimeAdapter({
      createServer: async () =>
        ({
          dispatch: vi.fn().mockRejectedValue(() => {
            const error = new Error("dial tcp") as Error & { code: string };
            error.code = "ECONNREFUSED";
            return error;
          }()),
        }) as unknown as AppServer,
      createStore: () => store,
      turns: {
        get: vi.fn(async () => ({ text: "Run this" })),
      } as never,
    });
    await expect(
      (async () => {
        const iterator = adapter.execute({
          session: { ownerId, threadId, agentVersion: { id: agentVersionId } },
          run: { id: runId, triggeringTurnId: turnId },
          signal: new AbortController().signal,
        } as unknown as RuntimeAdapterContext);
        for await (const event of iterator) {
          void event;
        }
      })(),
    ).rejects.toBeInstanceOf(RetryableRuntimeError);
  });

  it("does not classify hard protocol errors as retryable", async () => {
    const store = {
      get: vi.fn(async () => ({
        threadId,
        items: [],
        stepCount: 0,
        revision: 0,
      })),
      set: vi.fn(async () => undefined),
    } as unknown as PersistentThreadStore;
    const adapter = createHarnessRuntimeAdapter({
      createServer: async () =>
        ({
          dispatch: vi.fn().mockResolvedValue({
            jsonrpc: "2.0",
            id: "runtime-initialize",
            error: {
              code: 400,
              message: "invalid method",
            },
          }),
        }) as unknown as AppServer,
      createStore: () => store,
      turns: {
        get: vi.fn(async () => ({ text: "Run this" })),
      } as never,
    });
    await expect(
      (async () => {
        const iterator = adapter.execute({
          session: { ownerId, threadId, agentVersion: { id: agentVersionId } },
          run: { id: runId, triggeringTurnId: turnId },
          signal: new AbortController().signal,
        } as unknown as RuntimeAdapterContext);
        for await (const event of iterator) {
          void event;
        }
      })(),
    ).rejects.not.toBeInstanceOf(RetryableRuntimeError);
  });
});
