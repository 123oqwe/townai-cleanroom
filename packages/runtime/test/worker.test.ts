import { describe, expect, it, vi } from "vitest";

import { asId } from "@town/contracts";
import { createRuntimeWorker } from "../src/worker.js";
import { RetryableRuntimeError } from "../src/errors.js";
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

  it("drains a bounded batch and stops when the queue is empty", async () => {
    const queue = {
      claim: vi
        .fn()
        .mockResolvedValueOnce({
          ownerId,
          sessionId,
          runId,
          runState: "queued" as const,
          workerId: "worker-1",
          leaseToken,
          attempt: 1,
          leasedAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + 30_000),
        })
        .mockResolvedValueOnce(null),
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
    const dependencies = {
      queue,
      sessions: {
        get: vi.fn(async () => ({ ownerId }) as never),
        getRun: vi.fn(async () => ({}) as never),
      },
      transitions,
      adapter: {
        async *execute() {
          yield {
            type: "assistant_output" as const,
            text: "done",
            mentions: [],
          };
        },
      },
    } as unknown as RuntimeWorkerDependencies;

    const worker = createRuntimeWorker(dependencies, { workerId: "worker-1" });
    await expect(worker.runBatch(2)).resolves.toMatchObject({ processed: 1 });
    await expect(worker.runBatch(0)).rejects.toThrow(/between 1 and 100/);
    expect(queue.claim).toHaveBeenCalledTimes(2);
  });

  it("requeues only explicitly retryable adapter failures within the attempt budget", async () => {
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
      requeue: vi.fn(async () => undefined),
      wait: vi.fn(async () => undefined),
    };
    const dependencies = {
      queue,
      sessions: {
        get: vi.fn(async () => ({ ownerId }) as never),
        getRun: vi.fn(async () => ({}) as never),
      },
      transitions,
      adapter: {
        async *execute() {
          yield* [] as never[];
          throw new RetryableRuntimeError("provider unavailable");
        },
      },
    } as unknown as RuntimeWorkerDependencies;
    const result = await createRuntimeWorker(dependencies, {
      workerId: "worker-1",
      retryPolicy: { maxAttempts: 3, baseDelayMs: 250 },
    }).runOnce();
    expect(result).toMatchObject({ claimed: true, state: "queued", runId });
    expect(transitions.requeue).toHaveBeenCalledWith({
      runId,
      leaseToken,
      delayMs: 250,
    });
    expect(transitions.fail).not.toHaveBeenCalled();
  });

  it("fails when retryable errors exhaust the attempt budget", async () => {
    const queue = {
      claim: vi.fn(async () => ({
        ownerId,
        sessionId,
        runId,
        runState: "queued" as const,
        workerId: "worker-1",
        leaseToken,
        attempt: 3,
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
      requeue: vi.fn(async () => undefined),
      wait: vi.fn(async () => undefined),
    };
    const dependencies = {
      queue,
      sessions: {
        get: vi.fn(async () => ({ ownerId }) as never),
        getRun: vi.fn(async () => ({}) as never),
      },
      transitions,
      adapter: {
        async *execute() {
          throw new RetryableRuntimeError("provider unavailable");
        },
      },
    } as unknown as RuntimeWorkerDependencies;
    const result = await createRuntimeWorker(dependencies, {
      workerId: "worker-1",
      retryPolicy: { maxAttempts: 3, baseDelayMs: 250 },
    }).runOnce();
    expect(result).toMatchObject({ claimed: true, state: "failed", runId });
    expect(transitions.requeue).not.toHaveBeenCalled();
    expect(transitions.fail).toHaveBeenCalledWith({
      runId,
      leaseToken,
      errorCode: "RetryableRuntimeError",
    });
  });
});
