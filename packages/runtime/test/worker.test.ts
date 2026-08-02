import { describe, expect, it, vi } from "vitest";

import { asId } from "@town/contracts";
import { createRuntimeWorker } from "../src/worker.js";
import type { RuntimeWorkerDependencies } from "../src/worker.js";

const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");
const sessionId = asId<"runtime-session">(
  "01900000-0000-7000-8000-000000000002",
);
const runId = asId<"session-run">("01900000-0000-7000-8000-000000000003");
const leaseToken = "a".repeat(43);

describe("runtime worker", () => {
  it("claims, starts, forwards adapter events, and completes a run", async () => {
    const queue = {
      claim: vi.fn(async () => ({
        ownerId,
        sessionId,
        runId,
        runState: "queued" as const,
        workerId: "worker-1",
        leaseToken,
        attempt: 1,
        leasedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 30_000),
      })),
      heartbeat: vi.fn(async (value) => value),
      retry: vi.fn(async () => undefined),
    };
    const transitions = {
      start: vi.fn(async () => undefined),
      recordPhase: vi.fn(async () => undefined),
      recordAssistantOutput: vi.fn(async () => undefined),
      complete: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined),
      wait: vi.fn(async () => undefined),
    };
    const adapter = {
      async *execute() {
        yield { type: "phase" as const, phase: "model_running" as const };
        yield {
          type: "assistant_output" as const,
          text: "A real adapter response.",
          mentions: [],
        };
      },
    };
    const dependencies = {
      queue,
      sessions: {
        get: vi.fn(async () => ({ ownerId }) as never),
        getRun: vi.fn(async () => ({}) as never),
      },
      transitions,
      adapter,
    } as unknown as RuntimeWorkerDependencies;

    const onFinished = vi.fn(async () => undefined);
    const result = await createRuntimeWorker(dependencies, {
      workerId: "worker-1",
      leaseMs: 3_000,
      onFinished,
    }).runOnce();

    expect(result).toMatchObject({ claimed: true, state: "completed", runId });
    expect(transitions.start).toHaveBeenCalledWith({ runId, leaseToken });
    expect(transitions.recordPhase).toHaveBeenCalledWith({
      runId,
      leaseToken,
      phase: "model_running",
    });
    expect(transitions.recordAssistantOutput).toHaveBeenCalledWith({
      runId,
      leaseToken,
      text: "A real adapter response.",
      mentions: [],
    });
    expect(transitions.complete).toHaveBeenCalled();
    expect(onFinished).toHaveBeenCalledWith({
      ownerId,
      runId,
      state: "completed",
    });
  });
});
