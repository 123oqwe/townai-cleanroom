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
const baseUrl = "http://town.test";
const v1Url = `${baseUrl}/v1/integrations/twilio/voice/${routineId}`;
const legacyUrl = `${baseUrl}/integrations/twilio/voice/${routineId}`;

function signature(params: URLSearchParams, endpointUrl: string = v1Url) {
  const canonical = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}${value}`)
    .join("");
  return createHmac("sha1", authToken)
    .update(endpointUrl + canonical)
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
        url: v1Url,
        params,
        signature: signature(params, v1Url),
      }),
    ).toBe(true);
    expect(
      verifyTwilioSignature({
        authToken,
        url: v1Url,
        params,
        signature: "invalid",
      }),
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
    const response = await app.request(v1Url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signature(params, v1Url),
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

  it("accepts legacy Twilio callback path without v1", async () => {
    const sql = (async () => [{ owner_id: ownerId }]) as unknown as Sql;
    const queueTrigger = vi.fn(async (...args: unknown[]) => ({
      id: "run-legacy",
      args,
    }));
    const repository = { queueTrigger } as unknown as RoutineRepository;
    const app = new Hono<{ Variables: AuthVariables }>();
    registerTwilioVoiceEventsRoute(app, { sql, repository, authToken });

    const params = new URLSearchParams({
      CallSid: "CA2",
      TranscriptionSid: "TR2",
      TranscriptionText: "  legacy path",
      From: "+3000",
      To: "+4000",
    });
    const response = await app.request(legacyUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signature(params, legacyUrl),
      },
      body: params.toString(),
    });
    expect(response.status).toBe(202);
    expect(queueTrigger).toHaveBeenCalledWith(
      ownerId,
      asId<"routine-schedule">(routineId),
      "voice_transcribed",
      {
        text: "legacy path",
        callSid: "CA2",
        transcriptionSid: "TR2",
        from: "+3000",
        to: "+4000",
      },
      "twilio:TR2",
    );
  });
});
