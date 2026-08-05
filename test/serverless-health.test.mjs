import { describe, expect, it } from "vitest";

describe("serverless health probes", () => {
  it("stays diagnostic when the durable API environment is absent", async () => {
    const names = [
      "DATABASE_URL",
      "CREDENTIAL_MASTER_KEY_BASE64URL",
      "WEB_ORIGIN",
      "RESPONSES_API_KEY",
      "WORKER_SECRET",
      "CRON_SECRET",
      "SLACK_SIGNING_SECRET",
      "TWILIO_AUTH_TOKEN",
      "VAPI_WEBHOOK_SECRET",
      "ELEVENLABS_API_KEY",
      "ELEVENLABS_VOICE_ID",
      "GOOGLE_OAUTH_CLIENT_ID",
      "GOOGLE_OAUTH_CLIENT_SECRET",
      "GOOGLE_OAUTH_REDIRECT_URI",
      "WORKSPACE_ROOT",
      "CODE_RUNNER_ENABLED",
    ];
    const previous = new Map(names.map((name) => [name, process.env[name]]));
    for (const name of names) Reflect.deleteProperty(process.env, name);
    try {
      const { default: app } = await import("../api/index.js?health-test");
      const health = await app.request("/v1/health");
      expect(health.status).toBe(200);
      expect((await health.json()).status).toBe("ok");

      const capabilities = await app.request("/v1/health/capabilities");
      expect(capabilities.status).toBe(200);
      expect(await capabilities.json()).toEqual({
        api: false,
        auth: false,
        harness: false,
        harnessResponses: false,
        harnessCodex: false,
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
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) Reflect.deleteProperty(process.env, name);
        else process.env[name] = value;
      }
    }
  });

  it("does not report API readiness for malformed runtime configuration", async () => {
    const values = {
      DATABASE_URL: "https://not-postgres.example",
      CREDENTIAL_MASTER_KEY_BASE64URL: "not-a-key",
      WEB_ORIGIN: "not a url",
    };
    const previous = new Map(
      Object.keys(values).map((name) => [name, process.env[name]]),
    );
    Object.assign(process.env, values);
    try {
      const { default: app } =
        await import("../api/index.js?invalid-health-test");
      const capabilities = await app.request("/v1/health/capabilities");
      expect(capabilities.status).toBe(200);
      expect(await capabilities.json()).toMatchObject({
        api: false,
        auth: false,
      });
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) Reflect.deleteProperty(process.env, name);
        else process.env[name] = value;
      }
    }
  });
});
