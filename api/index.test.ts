import { describe, expect, it, beforeEach, afterEach } from "vitest";

import app from "./index.js";

describe("Vercel serverless health capabilities", () => {
  let baselineEnv: Record<string, string | undefined>;

  beforeEach(() => {
    baselineEnv = {
      DATABASE_URL: process.env["DATABASE_URL"],
      CREDENTIAL_MASTER_KEY_BASE64URL:
        process.env["CREDENTIAL_MASTER_KEY_BASE64URL"],
      WEB_ORIGIN: process.env["WEB_ORIGIN"],
      RESPONSES_API_KEY: process.env["RESPONSES_API_KEY"],
      WORKER_SECRET: process.env["WORKER_SECRET"],
      CRON_SECRET: process.env["CRON_SECRET"],
      WORKSPACE_ROOT: process.env["WORKSPACE_ROOT"],
      CODE_RUNNER_ENABLED: process.env["CODE_RUNNER_ENABLED"],
      SLACK_SIGNING_SECRET: process.env["SLACK_SIGNING_SECRET"],
      TWILIO_AUTH_TOKEN: process.env["TWILIO_AUTH_TOKEN"],
      VAPI_WEBHOOK_SECRET: process.env["VAPI_WEBHOOK_SECRET"],
      ELEVENLABS_API_KEY: process.env["ELEVENLABS_API_KEY"],
      ELEVENLABS_VOICE_ID: process.env["ELEVENLABS_VOICE_ID"],
      GOOGLE_OAUTH_CLIENT_ID: process.env["GOOGLE_OAUTH_CLIENT_ID"],
      GOOGLE_OAUTH_CLIENT_SECRET: process.env["GOOGLE_OAUTH_CLIENT_SECRET"],
      GOOGLE_OAUTH_REDIRECT_URI: process.env["GOOGLE_OAUTH_REDIRECT_URI"],
      CONTENT_STORAGE_ROOT: process.env["CONTENT_STORAGE_ROOT"],
      CONTENT_STORAGE_S3_ENDPOINT: process.env["CONTENT_STORAGE_S3_ENDPOINT"],
      CONTENT_STORAGE_S3_BUCKET: process.env["CONTENT_STORAGE_S3_BUCKET"],
      CONTENT_STORAGE_S3_REGION: process.env["CONTENT_STORAGE_S3_REGION"],
      CONTENT_STORAGE_S3_ACCESS_KEY_ID:
        process.env["CONTENT_STORAGE_S3_ACCESS_KEY_ID"],
      CONTENT_STORAGE_S3_SECRET_ACCESS_KEY:
        process.env["CONTENT_STORAGE_S3_SECRET_ACCESS_KEY"],
    };

    process.env = {
      ...process.env,
      DATABASE_URL: undefined,
      CREDENTIAL_MASTER_KEY_BASE64URL: undefined,
      WEB_ORIGIN: undefined,
      RESPONSES_API_KEY: undefined,
      WORKER_SECRET: undefined,
      CRON_SECRET: undefined,
      WORKSPACE_ROOT: undefined,
      CODE_RUNNER_ENABLED: undefined,
      SLACK_SIGNING_SECRET: undefined,
      TWILIO_AUTH_TOKEN: undefined,
      VAPI_WEBHOOK_SECRET: undefined,
      ELEVENLABS_API_KEY: undefined,
      ELEVENLABS_VOICE_ID: undefined,
      GOOGLE_OAUTH_CLIENT_ID: undefined,
      GOOGLE_OAUTH_CLIENT_SECRET: undefined,
      GOOGLE_OAUTH_REDIRECT_URI: undefined,
      CONTENT_STORAGE_ROOT: undefined,
      CONTENT_STORAGE_S3_ENDPOINT: undefined,
      CONTENT_STORAGE_S3_BUCKET: undefined,
      CONTENT_STORAGE_S3_REGION: undefined,
      CONTENT_STORAGE_S3_ACCESS_KEY_ID: undefined,
      CONTENT_STORAGE_S3_SECRET_ACCESS_KEY: undefined,
    };
  });

  afterEach(() => {
    process.env = { ...process.env, ...baselineEnv };
  });

  it("returns read-safe defaults when runtime is not configured", async () => {
    const response = await app.request("/v1/health/capabilities");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      api: false,
      auth: false,
      harness: false,
      worker: false,
      workspaceTools: false,
      codeRunner: false,
      slackEvents: false,
      twilioVoice: false,
      vapiVoice: false,
      voiceSynthesis: false,
      googleOAuth: false,
      contentStorage: false,
    });
  });

  it("reflects workspace and code-runner capability flags", async () => {
    process.env["DATABASE_URL"] = "postgres://user:pass@localhost:5432/db";
    process.env["CREDENTIAL_MASTER_KEY_BASE64URL"] = Buffer.from(
      "a".repeat(32),
      "utf8",
    ).toString("base64url");
    process.env["WEB_ORIGIN"] = "https://example.com";
    process.env["RESPONSES_API_KEY"] = "responses-key";
    process.env["WORKER_SECRET"] = "worker-secret";
    process.env["WORKSPACE_ROOT"] = "/tmp";
    process.env["CODE_RUNNER_ENABLED"] = "true";
    process.env["CONTENT_STORAGE_ROOT"] = "/tmp";

    const response = await app.request("/v1/health/capabilities");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      api: true,
      auth: true,
      harness: true,
      worker: true,
      workspaceTools: true,
      codeRunner: true,
      contentStorage: true,
    });
  });

  it("supports code runner off and workspace off independently", async () => {
    process.env["DATABASE_URL"] = "postgres://user:pass@localhost:5432/db";
    process.env["CREDENTIAL_MASTER_KEY_BASE64URL"] = Buffer.from(
      "b".repeat(32),
      "utf8",
    ).toString("base64url");
    process.env["WEB_ORIGIN"] = "https://example.com";
    process.env["SLACK_SIGNING_SECRET"] = "slack";
    process.env["TWILIO_AUTH_TOKEN"] = "twilio";
    process.env["VAPI_WEBHOOK_SECRET"] = "vapi";
    process.env["ELEVENLABS_API_KEY"] = "eleven";
    process.env["ELEVENLABS_VOICE_ID"] = "voice-id";
    process.env["GOOGLE_OAUTH_CLIENT_ID"] = "client-id";
    process.env["GOOGLE_OAUTH_CLIENT_SECRET"] = "client-secret";
    process.env["GOOGLE_OAUTH_REDIRECT_URI"] =
      "https://example.com/auth/google/callback";
    process.env["CONTENT_STORAGE_ROOT"] = undefined;
    process.env["CONTENT_STORAGE_S3_ENDPOINT"] = "https://s3.example.com";
    process.env["CONTENT_STORAGE_S3_BUCKET"] = "bucket";
    process.env["CONTENT_STORAGE_S3_REGION"] = "auto";
    process.env["CONTENT_STORAGE_S3_ACCESS_KEY_ID"] = "id";
    process.env["CONTENT_STORAGE_S3_SECRET_ACCESS_KEY"] = "secret";

    const response = await app.request("/v1/health/capabilities");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      workspaceTools: false,
      codeRunner: false,
      slackEvents: true,
      twilioVoice: true,
      vapiVoice: true,
      voiceSynthesis: true,
      googleOAuth: true,
      contentStorage: true,
    });
  });
});
