/**
 * Standalone durable worker process.
 *
 * This entry point reuses the same runtime composition as the API
 * (composeRuntime) but runs only the worker loop — no HTTP listener.
 * Deploy as a long-running process (e.g. Fly.io) alongside the API
 * on Vercel. Both processes share the same PostgreSQL database and
 * credential configuration.
 *
 * The worker polls session_runs via the cross-process-safe lease
 * mechanism (FOR UPDATE SKIP LOCKED), so multiple worker instances
 * can run concurrently without double-processing.
 */
import { composeRuntime } from "@town/api/compose";

async function main(): Promise<void> {
  const composition = await composeRuntime("worker");

  if (composition.runtimeWorker === undefined) {
    console.error(
      "Worker process started but no harness is configured.",
      "Set RESPONSES_API_KEY (or CODEX_EXEC_ENABLED on the worker side)",
      "to enable durable execution.",
    );
    process.exitCode = 1;
    return;
  }

  composition.workerLoop?.start();

  let shuttingDown = false;
  function shutdown(): void {
    if (shuttingDown) return;
    shuttingDown = true;
    composition.workerLoop?.stop();
    void composition.sql.end().finally(() => process.exit(0));
  }

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

void main().catch((error) => {
  console.error("Worker process failed to start.", error);
  process.exit(1);
});
