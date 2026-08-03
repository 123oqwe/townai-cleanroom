import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Sql } from "postgres";
import { asId } from "@town/contracts";
import type { RoutineRepository } from "@town/routines";
import type { AuthVariables } from "../src/auth.js";
import { registerVapiVoiceEventsRoute } from "../src/vapi-voice-events.js";

const routineId = "01900000-0000-7000-8000-000000000004";
const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");
const secret = "vapi-webhook-secret";

describe("Vapi voice events adapter", () => {
  it("rejects unauthenticated events and queues a final transcript", async () => {
    const sql = (async () => [{ owner_id: ownerId }]) as unknown as Sql;
    const queueTrigger = vi.fn(async (...args: unknown[]) => ({
      id: "run-1",
      args,
    }));
    const app = new Hono<{ Variables: AuthVariables }>();
    registerVapiVoiceEventsRoute(app, {
      sql,
      repository: { queueTrigger } as unknown as RoutineRepository,
      webhookSecret: secret,
    });
    const payload = JSON.stringify({
      message: {
        type: "transcript",
        role: "user",
        transcript: "Please remember this",
        call: { id: "call_123" },
      },
    });
    const unauthorized = await app.request(
      `http://town.test/v1/integrations/vapi/voice/${routineId}`,
      { method: "POST", body: payload },
    );
    expect(unauthorized.status).toBe(401);
    const response = await app.request(
      `http://town.test/v1/integrations/vapi/voice/${routineId}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
        body: payload,
      },
    );
    expect(response.status).toBe(202);
    expect(queueTrigger).toHaveBeenCalledWith(
      ownerId,
      asId<"routine-schedule">(routineId),
      "voice_transcribed",
      {
        text: "Please remember this",
        callId: "call_123",
        eventType: "transcript",
      },
      "vapi:call_123:transcript",
    );
  });
});
