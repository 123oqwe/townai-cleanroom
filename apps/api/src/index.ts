import { serve } from "@hono/node-server";
import { timingSafeEqual } from "node:crypto";

import { composeRuntime } from "./compose.js";
import { environment } from "./config.js";
import { assertProductionAuthConfig } from "./lib/auth-config.js";

export type { Environment } from "./config.js";

// Fail fast on production auth misconfiguration before serving traffic.
assertProductionAuthConfig(environment);

const composition = await composeRuntime("api");
const app = composition.app;
export default app;

const workerSecret = environment.WORKER_SECRET ?? environment.CRON_SECRET;
if (workerSecret !== undefined) {
  app.post("/v1/internal/worker", async (context) => {
    const supplied = context.req
      .header("Authorization")
      ?.match(/^Bearer ([^\s,]+)$/)?.[1];
    if (supplied === undefined)
      return context.json({ code: "UNAUTHORIZED" }, 401);
    const expected = Buffer.from(workerSecret);
    const actual = Buffer.from(supplied);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      return context.json({ code: "UNAUTHORIZED" }, 401);
    const schedule =
      composition.routineScheduler === undefined
        ? undefined
        : await composition.routineScheduler();
    return context.json({
      schedule,
      google: await composition.googleRoutinePoller.poll(),
      calendar: await composition.googleCalendarPoller.poll(),
      runtime:
        composition.runtimeWorker === undefined
          ? undefined
          : await composition.runtimeWorker.runBatch(
              environment.WORKER_BATCH_SIZE,
            ),
      channel: await composition.channelRepository.deliverNext({
        workerId: composition.workerId,
        sendEmail: async (value) => {
          await composition.googleApi.gmailSend(value);
        },
        resolveCredential: async ({ credentialRef }) => {
          const credential = composition.channelCredentials[credentialRef];
          if (credential === undefined)
            throw new Error("CHANNEL_CREDENTIAL_UNAVAILABLE");
          return credential;
        },
      }),
    });
  });
}

if (process.env["VERCEL"] !== "1") {
  composition.workerLoop?.start();

  const server = serve({
    fetch: app.fetch,
    port: environment.PORT,
  });
  let shuttingDown = false;

  function shutdown(): void {
    if (shuttingDown) return;
    shuttingDown = true;
    composition.workerLoop?.stop();
    server.close(() => {
      void composition.sql.end().finally(() => process.exit(0));
    });
  }

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
