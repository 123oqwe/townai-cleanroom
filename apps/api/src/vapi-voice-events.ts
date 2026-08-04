import type { Context, Hono } from "hono";
import type { Sql } from "postgres";
import { z } from "zod";
import { asId } from "@town/contracts";
import type { RoutineRepository } from "@town/routines";
import type { AuthVariables } from "./auth.js";

const vapiPayloadSchema = z
  .object({
    message: z
      .object({
        type: z.string(),
        role: z.string().optional(),
        transcript: z.string().optional(),
        call: z.object({ id: z.string().trim().min(1).max(200) }).optional(),
        artifact: z
          .object({ transcript: z.string().optional() })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  })
  .strict();

export interface VapiVoiceEventsDependencies {
  sql: Sql;
  repository: RoutineRepository;
  webhookSecret: string;
}

/** Ingest Vapi transcript/end-of-call events into the durable voice trigger. */
export function registerVapiVoiceEventsRoute(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: VapiVoiceEventsDependencies,
): void {
  const route = async (context: Context<{ Variables: AuthVariables }>) => {
    const rawBody = await context.req.raw.text();
    if (Buffer.byteLength(rawBody, "utf8") > 512 * 1024)
      return context.json({ code: "PAYLOAD_TOO_LARGE" }, 413);
    const supplied =
      context.req.header("Authorization")?.match(/^Bearer ([^\s,]+)$/)?.[1] ??
      context.req.header("X-Vapi-Secret");
    if (supplied !== dependencies.webhookSecret)
      return context.json({ code: "VAPI_UNAUTHORIZED" }, 401);
    let body: z.infer<typeof vapiPayloadSchema>;
    try {
      body = vapiPayloadSchema.parse(JSON.parse(rawBody));
    } catch {
      return context.json({ code: "INVALID_JSON" }, 400);
    }
    const message = body.message;
    const transcript =
      message.transcript?.trim() ?? message.artifact?.transcript?.trim();
    const callId = message.call?.id;
    const acceptedType =
      message.type === "transcript" || message.type === "end-of-call-report";
    const userTranscript =
      message.role === undefined || message.role === "user";
    if (!acceptedType || !userTranscript || !transcript || !callId)
      return context.json({ accepted: false, reason: "IGNORED_EVENT" });
    const routineId = asId<"routine-schedule">(context.req.param("routineId"));
    const [owner] = await dependencies.sql<{ owner_id: string }[]>`
      select owner_id from routine_schedules
      where id=${routineId} and enabled=true
      limit 1
    `;
    if (owner === undefined)
      return context.json({ code: "ROUTINE_NOT_FOUND" }, 404);
    const run = await dependencies.repository.queueTrigger(
      asId<"user">(owner.owner_id),
      routineId,
      "voice_transcribed",
      { text: transcript, callId, eventType: message.type },
      `vapi:${callId}:${message.type}`,
    );
    // Vapi treats informational server events as acknowledged once the
    // request returns successfully; durable execution continues off-request.
    return context.json({ accepted: true, run });
  };

  app.post("/v1/integrations/vapi/voice/:routineId", route);
  app.post("/integrations/vapi/voice/:routineId", route);
}
