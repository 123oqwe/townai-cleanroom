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
}

export interface RuntimeWorkerResult {
  claimed: boolean;
  state?: "completed" | "failed" | "waiting_approval" | "waiting_user_input";
  runId?: string;
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

  return { runOnce };
}

export type RuntimeWorker = ReturnType<typeof createRuntimeWorker>;
