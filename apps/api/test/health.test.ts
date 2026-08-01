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
});
