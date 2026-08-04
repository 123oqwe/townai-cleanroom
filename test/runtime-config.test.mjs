import { describe, expect, it } from "vitest";

import { inspectRuntimeConfig } from "../scripts/check-runtime-config.mjs";

describe("runtime configuration preflight", () => {
  it("reports missing required configuration without exposing values", () => {
    const result = inspectRuntimeConfig({});
    expect(result.missingRequired).toEqual([
      "DATABASE_URL",
      "CREDENTIAL_MASTER_KEY_BASE64URL",
      "WEB_ORIGIN",
    ]);
    expect(result.checks).not.toContainEqual(
      expect.objectContaining({ value: expect.anything() }),
    );
  });

  it("accepts a 32-byte key and rejects malformed URLs", () => {
    const result = inspectRuntimeConfig({
      DATABASE_URL: "https://not-postgres.example",
      CREDENTIAL_MASTER_KEY_BASE64URL:
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      WEB_ORIGIN: "https://app.example",
    });
    expect(result.checks).toContainEqual({
      name: "DATABASE_URL",
      status: "invalid",
    });
    expect(result.checks).toContainEqual({
      name: "CREDENTIAL_MASTER_KEY_BASE64URL",
      status: "configured",
    });
  });

  it("reports optional provider wiring without treating it as deployment-blocking", () => {
    const result = inspectRuntimeConfig({
      DATABASE_URL: "postgres://user:pass@localhost/db",
      CREDENTIAL_MASTER_KEY_BASE64URL:
        "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE",
      WEB_ORIGIN: "https://app.example",
      SLACK_SIGNING_SECRET: "slack-secret",
      TWILIO_AUTH_TOKEN: "twilio-secret",
      VAPI_WEBHOOK_SECRET: "vapi-secret",
      ELEVENLABS_API_KEY: "eleven-key",
      ELEVENLABS_VOICE_ID: "eleven-voice",
      GOOGLE_OAUTH_CLIENT_ID: "client-id",
      GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
      GOOGLE_OAUTH_REDIRECT_URI: "https://app.example/oauth/callback",
      CHANNEL_CREDENTIALS_JSON: JSON.stringify({ telegram: "bot-token" }),
    });

    for (const check of result.checks) {
      if (check.name.endsWith("ALLOWLIST_EMAILS") || check.name === "WORKER_SECRET_OR_CRON_SECRET")
        continue;
      if (check.name === "RESPONSES_API_KEY") continue;
      if ([
        "SLACK_SIGNING_SECRET",
        "TWILIO_AUTH_TOKEN",
        "VAPI_WEBHOOK_SECRET",
        "ELEVENLABS_API_KEY",
        "ELEVENLABS_VOICE_ID",
        "GOOGLE_OAUTH_CLIENT_ID",
        "GOOGLE_OAUTH_CLIENT_SECRET",
        "GOOGLE_OAUTH_REDIRECT_URI",
        "CHANNEL_CREDENTIALS_JSON",
      ].includes(check.name)) {
        expect(check.status).toBe("configured");
      }
    }
    expect(result.missingRequired).toEqual([]);
  });

  it("marks malformed optional values as invalid but not required", () => {
    const result = inspectRuntimeConfig({
      DATABASE_URL: "postgres://user:pass@localhost/db",
      CREDENTIAL_MASTER_KEY_BASE64URL:
        "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE",
      WEB_ORIGIN: "https://app.example",
      GOOGLE_OAUTH_REDIRECT_URI: "not-a-url",
      CHANNEL_CREDENTIALS_JSON: "{bad-json",
    });

    expect(result.checks).toEqual(
      expect.arrayContaining([
        { name: "GOOGLE_OAUTH_REDIRECT_URI", status: "invalid" },
        { name: "CHANNEL_CREDENTIALS_JSON", status: "invalid" },
      ]),
    );
    expect(result.missingRequired).toEqual([]);
  });

  it("keeps optional integration settings as missing instead of required", () => {
    const result = inspectRuntimeConfig({
      DATABASE_URL: "postgres://user:pass@localhost/db",
      CREDENTIAL_MASTER_KEY_BASE64URL:
        "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE",
      WEB_ORIGIN: "https://app.example",
    });

    expect(result.checks).toEqual(
      expect.arrayContaining([
        { name: "SLACK_SIGNING_SECRET", status: "missing" },
        { name: "TWILIO_AUTH_TOKEN", status: "missing" },
        { name: "VAPI_WEBHOOK_SECRET", status: "missing" },
        { name: "ELEVENLABS_API_KEY", status: "missing" },
        { name: "ELEVENLABS_VOICE_ID", status: "missing" },
        { name: "GOOGLE_OAUTH_CLIENT_ID", status: "missing" },
        { name: "GOOGLE_OAUTH_CLIENT_SECRET", status: "missing" },
        { name: "GOOGLE_OAUTH_REDIRECT_URI", status: "missing" },
        { name: "CHANNEL_CREDENTIALS_JSON", status: "missing" },
      ]),
    );
    expect(result.missingRequired).toEqual([]);
  });
});
