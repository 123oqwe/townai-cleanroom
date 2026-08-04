import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { RoutineError } from "@town/routines";

describe("routine webhook rate-limit mapping", () => {
  it("returns 429 when the routine webhook rate limit is exceeded", async () => {
    const app = createApp({
      identityService: {} as never,
      accountRepository: {} as never,
      routineRepository: {
        deliverWebhook: async () => {
          throw new RoutineError(
            "WEBHOOK_RATE_LIMITED",
            "The routine webhook rate limit was exceeded.",
          );
        },
      } as never,
    });

    const response = await app.request(
      "http://town.test/routine-webhooks/01900000-0000-7000-8000-000000000001",
      {
        method: "POST",
        headers: {
          authorization: "Bearer whsec_test_secret_123456",
          "content-type": "application/json",
          "x-town-idempotency-key": "event-rate-limited",
        },
        body: JSON.stringify({ event: "ping" }),
      },
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      status: 429,
      code: "WEBHOOK_RATE_LIMITED",
      type: "https://town.local/problems/rate-limit",
    });
  });
});
