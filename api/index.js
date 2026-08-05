/* global Buffer, URL, console, process */

// Vercel's function entry point. `pnpm build` creates the workspace output
// before Vercel bundles this file, so the platform does not re-typecheck the
// entire source graph with a different compiler configuration.
//
// The application module intentionally requires real database/crypto
// configuration at startup. Lazy loading keeps an unconfigured preview
// diagnosable: it returns a structured 503 instead of an opaque import crash.
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Hono } from "hono";

function isValidWebOrigin(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isValidDatabaseUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "postgres:" || url.protocol === "postgresql:";
  } catch {
    return false;
  }
}

function isValidCredentialKey(value) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    return Buffer.from(value, "base64url").length === 32;
  } catch {
    return false;
  }
}

function isValidContentStorageConfig() {
  const hasRoot = process.env.CONTENT_STORAGE_ROOT !== undefined;
  const s3Endpoint = process.env.CONTENT_STORAGE_S3_ENDPOINT;
  const s3Bucket = process.env.CONTENT_STORAGE_S3_BUCKET;
  const s3Region = process.env.CONTENT_STORAGE_S3_REGION;
  const s3AccessKeyId = process.env.CONTENT_STORAGE_S3_ACCESS_KEY_ID;
  const s3SecretAccessKey = process.env.CONTENT_STORAGE_S3_SECRET_ACCESS_KEY;
  const hasAnyS3 = [
    s3Endpoint,
    s3Bucket,
    s3Region,
    s3AccessKeyId,
    s3SecretAccessKey,
  ].some((value) => value !== undefined);
  const hasAllS3 = [
    s3Endpoint,
    s3Bucket,
    s3Region,
    s3AccessKeyId,
    s3SecretAccessKey,
  ].every((value) => value !== undefined);
  if (hasRoot) return !hasAnyS3;
  return hasAllS3;
}

function isEnabled(value) {
  return value === "true";
}

function codexBinaryResolvable(explicitPath) {
  if (explicitPath !== undefined && explicitPath.length > 0) {
    try {
      return existsSync(explicitPath);
    } catch {
      return false;
    }
  }
  try {
    const which = execFileSync("which", ["codex"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return which.length > 0 && existsSync(which);
  } catch {
    return false;
  }
}

const app = new Hono();
let runtimePromise;
let runtimeError;
let runtimeErrorLogged = false;

function hasRequiredRuntimeConfig() {
  return Boolean(
    isValidDatabaseUrl(process.env.DATABASE_URL) &&
    isValidCredentialKey(process.env.CREDENTIAL_MASTER_KEY_BASE64URL) &&
    isValidWebOrigin(process.env.WEB_ORIGIN),
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
    harness: Boolean(
      process.env.RESPONSES_API_KEY ||
      (isEnabled(process.env.CODEX_EXEC_ENABLED) && codexBinaryResolvable()),
    ),
    harnessResponses: Boolean(process.env.RESPONSES_API_KEY),
    harnessCodex:
      isEnabled(process.env.CODEX_EXEC_ENABLED) && codexBinaryResolvable(),
    worker: Boolean(process.env.WORKER_SECRET || process.env.CRON_SECRET),
    workspaceTools: Boolean(process.env.WORKSPACE_ROOT),
    codeRunner: isEnabled(process.env.CODE_RUNNER_ENABLED),
    slackEvents: Boolean(process.env.SLACK_SIGNING_SECRET),
    twilioVoice: Boolean(process.env.TWILIO_AUTH_TOKEN),
    vapiVoice: Boolean(process.env.VAPI_WEBHOOK_SECRET),
    voiceSynthesis: Boolean(
      process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID,
    ),
    googleOAuth: Boolean(
      process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
      process.env.GOOGLE_OAUTH_REDIRECT_URI,
    ),
    gmailPubsub: Boolean(
      process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_PUBSUB_TOPIC,
    ),
    contentStorage: isValidContentStorageConfig(),
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
