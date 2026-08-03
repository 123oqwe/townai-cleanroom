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
    expect(await response.json()).toEqual({
      api: false,
      auth: false,
      harness: false,
      worker: false,
      googleOAuth: false,
    });
  });

  it("reports injected Harness and worker readiness independently", async () => {
    const response = await createApp({
      identityService: {} as never,
      accountRepository: {} as never,
      harnessServerFactory: (() => ({ dispatch: async () => new Response() })) as never,
      workerEnabled: true,
    }).request("/v1/health/capabilities");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      api: true,
      auth: true,
      harness: true,
      worker: true,
      googleOAuth: false,
    });
  });
});
