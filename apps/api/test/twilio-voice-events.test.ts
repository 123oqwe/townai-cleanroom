import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Sql } from "postgres";
import { asId } from "@town/contracts";
import type { RoutineRepository } from "@town/routines";
import type { AuthVariables } from "../src/auth.js";
import {
  registerTwilioVoiceEventsRoute,
  verifyTwilioSignature,
} from "../src/twilio-voice-events.js";

const authToken = "twilio-auth-token";
const routineId = "01900000-0000-7000-8000-000000000004";
const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");
const url = `http://town.test/v1/integrations/twilio/voice/${routineId}`;

function signature(params: URLSearchParams) {
  const canonical = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}${value}`)
    .join("");
  return createHmac("sha1", authToken)
    .update(url + canonical)
    .digest("base64");
}

describe("Twilio voice transcription adapter", () => {
  it("validates Twilio's sorted form parameter signature", () => {
    const params = new URLSearchParams({
      CallSid: "CA1",
      TranscriptionText: "hello",
    });
    expect(
      verifyTwilioSignature({
        authToken,
        url,
        params,
        signature: signature(params),
      }),
    ).toBe(true);
    expect(
      verifyTwilioSignature({ authToken, url, params, signature: "invalid" }),
    ).toBe(false);
  });

  it("queues a signed transcription with a durable transcription id", async () => {
    const sql = (async () => [{ owner_id: ownerId }]) as unknown as Sql;
    const queueTrigger = vi.fn(async (...args: unknown[]) => ({
      id: "run-1",
      args,
    }));
    const repository = { queueTrigger } as unknown as RoutineRepository;
    const app = new Hono<{ Variables: AuthVariables }>();
    registerTwilioVoiceEventsRoute(app, { sql, repository, authToken });
    const params = new URLSearchParams({
      CallSid: "CA1",
      TranscriptionSid: "TR1",
      TranscriptionText: "  remember this  ",
      From: "+1000",
      To: "+2000",
    });
    const response = await app.request(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signature(params),
      },
      body: params.toString(),
    });
    expect(response.status).toBe(202);
    expect(queueTrigger).toHaveBeenCalledWith(
      ownerId,
      asId<"routine-schedule">(routineId),
      "voice_transcribed",
      {
        text: "remember this",
        callSid: "CA1",
        transcriptionSid: "TR1",
        from: "+1000",
        to: "+2000",
      },
      "twilio:TR1",
    );
  });
});
