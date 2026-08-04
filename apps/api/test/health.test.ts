import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createApp } from "../src/app.js";

const healthSchema = z
  .object({
    status: z.literal("ok"),
    service: z.literal("town-api"),
    version: z.string().min(1),
    time: z.iso.datetime({ offset: true }),
  })
  .strict();

describe("GET /v1/health", () => {
  it("returns the public service health contract", async () => {
    const response = await createApp().request("/v1/health");

    expect(response.status).toBe(200);
    expect(healthSchema.parse(await response.json())).toMatchObject({
      status: "ok",
      service: "town-api",
    });
  });

  it("reports capability readiness without exposing configuration values", async () => {
    const response = await createApp().request("/v1/health/capabilities");
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

  it("reports injected Harness and worker readiness independently", async () => {
    const response = await createApp({
      identityService: {} as never,
      accountRepository: {} as never,
      harnessServerFactory: (() => ({
        dispatch: async () => new Response(),
      })) as never,
      workerEnabled: true,
    }).request("/v1/health/capabilities");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      api: true,
      auth: true,
      harness: true,
      worker: true,
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

  it("reflects read-only content storage in capabilities", async () => {
    const response = await createApp({
      identityService: {} as never,
      accountRepository: {} as never,
      contentStorage: {
        read: async () => null,
      },
      slackSigningSecret: "slack-signing-secret",
      twilioAuthToken: "twilio-token",
      vapiWebhookSecret: "vapi-secret",
      voiceProvider: {} as never,
      googleOAuth: {} as never,
    }).request("/v1/health/capabilities");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      contentStorage: "read-only",
      workspaceTools: false,
      codeRunner: false,
    });
  });

  it("reflects injected workspace tool and code runner readiness", async () => {
    const response = await createApp({
      identityService: {} as never,
      accountRepository: {} as never,
      workspaceTools: true,
      codeRunner: true,
    }).request("/v1/health/capabilities");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      workspaceTools: true,
      codeRunner: true,
    });
  });

  it("surfaces provider integration capabilities independently", async () => {
    const response = await createApp({
      identityService: {} as never,
      accountRepository: {} as never,
      slackSigningSecret: "slack-signing-secret",
      twilioAuthToken: "twilio-token",
      vapiWebhookSecret: "vapi-secret",
      voiceProvider: {} as never,
      googleOAuth: {} as never,
      workerEnabled: false,
      harnessServerFactory: () =>
        ({ dispatch: async () => new Response() }) as never,
    }).request("/v1/health/capabilities");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      api: true,
      auth: true,
      harness: true,
      worker: false,
      workspaceTools: false,
      codeRunner: false,
      slackEvents: true,
      twilioVoice: true,
      vapiVoice: true,
      voiceSynthesis: true,
      googleOAuth: true,
      contentStorage: false,
    });
  });
});
