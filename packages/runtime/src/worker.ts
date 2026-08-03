import type { RuntimeQueueRepository } from "./queue-repository.js";
import type { RuntimeAdapter } from "./runtime-adapter.js";
import type { RuntimeSession, SessionRun } from "./types.js";
import type { RuntimeTransitionService } from "./transition-service.js";
import type { SessionRepository } from "./session-repository.js";

export interface RuntimeWorkerDependencies {
  queue: RuntimeQueueRepository;
  sessions: SessionRepository;
  transitions: RuntimeTransitionService;
  adapter: RuntimeAdapter;
}

export interface RuntimeWorkerOptions {
  workerId: string;
  leaseMs?: number;
  onFinished?: (input: {
    ownerId: RuntimeSession["ownerId"];
    runId: SessionRun["id"];
    state: "completed" | "failed";
    errorCode?: string;
  }) => Promise<void>;
}

export interface RuntimeWorkerResult {
  claimed: boolean;
  state?: "completed" | "failed" | "waiting_approval" | "waiting_user_input";
  runId?: string;
}

export interface RuntimeWorkerBatchResult {
  processed: number;
  results: RuntimeWorkerResult[];
}

/**
 * Executes one durable queue item. The adapter is the only model/provider
 * boundary; this worker never invents assistant output when the adapter emits
 * nothing. A caller can invoke runOnce from a cron, queue consumer, or long
 * running process.
 */
export function createRuntimeWorker(
  dependencies: RuntimeWorkerDependencies,
  options: RuntimeWorkerOptions,
) {
  const leaseMs = options.leaseMs ?? 30_000;

  async function runOnce(): Promise<RuntimeWorkerResult> {
    const lease = await dependencies.queue.claim({
      workerId: options.workerId,
      leaseMs,
    });
    if (lease === null) return { claimed: false };

    const session = await dependencies.sessions.get(
      lease.ownerId,
      lease.sessionId,
    );
    const run = await dependencies.sessions.getRun(
      lease.ownerId,
      lease.sessionId,
      lease.runId,
    );
    const heartbeatEvery = Math.max(1_000, Math.floor(leaseMs / 3));
    const heartbeat = setInterval(() => {
      void dependencies.queue
        .heartbeat({
          runId: lease.runId,
          leaseToken: lease.leaseToken,
          leaseMs,
        })
        .catch(() => undefined);
    }, heartbeatEvery);

    let started = false;
    try {
      await dependencies.transitions.start({
        runId: lease.runId,
        leaseToken: lease.leaseToken,
      });
      started = true;
      const currentSession = session as RuntimeSession;
      const currentRun = run as SessionRun;
      for await (const event of dependencies.adapter.execute({
        session: currentSession,
        run: currentRun,
        leaseToken: lease.leaseToken,
        signal: AbortSignal.timeout(leaseMs),
      })) {
        if (event.type === "phase") {
          await dependencies.transitions.recordPhase({
            runId: lease.runId,
            leaseToken: lease.leaseToken,
            phase: event.phase,
          });
        } else if (event.type === "assistant_output") {
          await dependencies.transitions.recordAssistantOutput({
            runId: lease.runId,
            leaseToken: lease.leaseToken,
            text: event.text,
            mentions: event.mentions,
          });
        } else {
          await dependencies.transitions.wait({
            runId: lease.runId,
            leaseToken: lease.leaseToken,
            state:
              event.type === "waiting_user_input"
                ? "waiting_user_input"
                : "waiting_approval",
            reason: event.reason,
            ...(event.type === "waiting_approval" &&
            event.approvalId !== undefined
              ? { approvalId: event.approvalId }
              : {}),
          });
          return {
            claimed: true,
            state:
              event.type === "waiting_user_input"
                ? "waiting_user_input"
                : "waiting_approval",
            runId: lease.runId,
          };
        }
      }
      await dependencies.transitions.complete({
        runId: lease.runId,
        leaseToken: lease.leaseToken,
        outcome: { workerId: options.workerId, attempt: lease.attempt },
      });
      try {
        await options.onFinished?.({
          ownerId: currentSession.ownerId,
          runId: lease.runId,
          state: "completed",
        });
      } catch {
        // Reconciliation is best-effort and must not turn a completed run into a retry.
      }
      return { claimed: true, state: "completed", runId: lease.runId };
    } catch (error) {
      if (started) {
        await dependencies.transitions
          .fail({
            runId: lease.runId,
            leaseToken: lease.leaseToken,
            errorCode: error instanceof Error ? error.name : "RUNTIME_FAILURE",
          })
          .catch(() => undefined);
        try {
          await options.onFinished?.({
            ownerId: session.ownerId,
            runId: lease.runId,
            state: "failed",
            errorCode: error instanceof Error ? error.name : "RUNTIME_FAILURE",
          });
        } catch {
          // Reconciliation is best-effort and must not turn a failed run into a retry.
        }
      } else {
        await dependencies.queue
          .retry({
            runId: lease.runId,
            leaseToken: lease.leaseToken,
            delayMs: 1_000,
          })
          .catch(() => undefined);
      }
      return { claimed: true, state: "failed", runId: lease.runId };
    } finally {
      clearInterval(heartbeat);
    }
  }

  async function runBatch(maxItems = 10): Promise<RuntimeWorkerBatchResult> {
    if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 100) {
      throw new RangeError("maxItems must be an integer between 1 and 100");
    }
    const results: RuntimeWorkerResult[] = [];
    for (let index = 0; index < maxItems; index += 1) {
      const result = await runOnce();
      if (!result.claimed) break;
      results.push(result);
    }
    return { processed: results.length, results };
  }

  return { runOnce, runBatch };
}

export type RuntimeWorker = ReturnType<typeof createRuntimeWorker>;
