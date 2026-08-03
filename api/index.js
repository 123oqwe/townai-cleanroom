/* global console, process */

// Vercel's function entry point. `pnpm build` creates the workspace output
// before Vercel bundles this file, so the platform does not re-typecheck the
// entire source graph with a different compiler configuration.
//
// The application module intentionally requires real database/crypto
// configuration at startup. Lazy loading keeps an unconfigured preview
// diagnosable: it returns a structured 503 instead of an opaque import crash.
import { Hono } from "hono";

const app = new Hono();
let runtimePromise;
let runtimeError;
let runtimeErrorLogged = false;

function hasRequiredRuntimeConfig() {
  return Boolean(
    process.env.DATABASE_URL &&
    process.env.CREDENTIAL_MASTER_KEY_BASE64URL &&
    process.env.WEB_ORIGIN,
  );
}

app.get("/v1/health", (context) =>
  context.json({
    status: "ok",
    service: "town-api",
    version: process.env.TOWN_API_VERSION || "0.0.0",
    time: new Date().toISOString(),
  }),
);

app.get("/v1/health/capabilities", (context) =>
  context.json({
    api: hasRequiredRuntimeConfig(),
    auth: hasRequiredRuntimeConfig(),
    harness: Boolean(process.env.RESPONSES_API_KEY),
    worker: Boolean(process.env.WORKER_SECRET || process.env.CRON_SECRET),
    googleOAuth: Boolean(
      process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
      process.env.GOOGLE_OAUTH_REDIRECT_URI,
    ),
  }),
);

async function runtime() {
  if (runtimePromise === undefined) {
    runtimePromise = import("../apps/api/dist/index.js").then(
      (module) => module.default,
    );
    runtimePromise.catch((error) => {
      runtimeError = error;
    });
  }
  return runtimePromise;
}

app.all("*", async (context) => {
  try {
    const loaded = await runtime();
    return loaded.fetch(context.req.raw);
  } catch {
    if (!runtimeErrorLogged && runtimeError !== undefined) {
      runtimeErrorLogged = true;
      console.error("Town API runtime failed to initialize.", runtimeError);
    }
    return context.json(
      {
        code: "API_NOT_CONFIGURED",
        status: 503,
        detail: "The API runtime is not configured.",
      },
      503,
    );
  }
});

export default app;
