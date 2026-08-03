import { createHmac, timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import type { Sql } from "postgres";
import { asId } from "@town/contracts";
import type { RoutineRepository } from "@town/routines";
import type { AuthVariables } from "./auth.js";

function twilioSignatureBase(url: string, params: URLSearchParams): string {
  const entries = [...params.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return url + entries.map(([key, value]) => `${key}${value}`).join("");
}

/** Validate Twilio's X-Twilio-Signature for an application/x-www-form-urlencoded request. */
export function verifyTwilioSignature(input: {
  authToken: string;
  url: string;
  params: URLSearchParams;
  signature: string | undefined;
}): boolean {
  if (input.signature === undefined) return false;
  const expected = createHmac("sha1", input.authToken)
    .update(twilioSignatureBase(input.url, input.params))
    .digest("base64");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(input.signature, "utf8");
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

export interface TwilioVoiceEventsDependencies {
  sql: Sql;
  repository: RoutineRepository;
  authToken: string;
}

/** Ingests a Twilio transcription callback and queues a durable voice trigger. */
export function registerTwilioVoiceEventsRoute(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: TwilioVoiceEventsDependencies,
): void {
  app.post("/v1/integrations/twilio/voice/:routineId", async (context) => {
    const rawBody = await context.req.raw.text();
    if (Buffer.byteLength(rawBody, "utf8") > 256 * 1024)
      return context.json({ code: "PAYLOAD_TOO_LARGE" }, 413);
    const params = new URLSearchParams(rawBody);
    if (
      !verifyTwilioSignature({
        authToken: dependencies.authToken,
        url: context.req.url,
        params,
        signature: context.req.header("x-twilio-signature"),
      })
    )
      return context.json({ code: "TWILIO_SIGNATURE_INVALID" }, 401);
    const transcription = params.get("TranscriptionText")?.trim();
    const callSid = params.get("CallSid")?.trim();
    if (transcription === undefined || transcription.length === 0)
      return context.json({ accepted: false, reason: "NO_TRANSCRIPTION" });
    if (callSid === undefined || callSid.length === 0)
      return context.json({ code: "CALL_SID_REQUIRED" }, 400);
    const routineId = asId<"routine-schedule">(context.req.param("routineId"));
    const [owner] = await dependencies.sql<{ owner_id: string }[]>`
      select owner_id from routine_schedules
      where id=${routineId} and enabled=true
      limit 1
    `;
    if (owner === undefined)
      return context.json({ code: "ROUTINE_NOT_FOUND" }, 404);
    const transcriptionSid = params.get("TranscriptionSid")?.trim();
    const idempotencyKey = `twilio:${transcriptionSid ?? callSid}`;
    const run = await dependencies.repository.queueTrigger(
      asId<"user">(owner.owner_id),
      routineId,
      "voice_transcribed",
      {
        text: transcription,
        callSid,
        ...(transcriptionSid === null ? {} : { transcriptionSid }),
        from: params.get("From"),
        to: params.get("To"),
      },
      idempotencyKey,
    );
    return context.json({ accepted: true, run }, 202);
  });
}
