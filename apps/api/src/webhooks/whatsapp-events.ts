import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { Sql } from "postgres";
import { asId } from "@town/contracts";
import type { RoutineRepository } from "@town/routines";
import type { AuthVariables } from "../lib/auth.js";

const whatsappEnvelopeSchema = z
  .object({
    object: z.string(),
    entry: z
      .array(
        z
          .object({
            id: z.string().optional(),
            changes: z
              .array(
                z
                  .object({
                    field: z.string().optional(),
                    value: z
                      .object({
                        messaging_product: z.string().optional(),
                        messages: z
                          .array(
                            z
                              .object({
                                id: z.string(),
                                from: z.string(),
                                text: z.object({ body: z.string() }).optional(),
                                timestamp: z.string().optional(),
                                type: z.string().optional(),
                              })
                              .passthrough(),
                          )
                          .optional(),
                      })
                      .passthrough()
                      .optional(),
                  })
                  .passthrough(),
              )
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

export interface WhatsAppEventsDependencies {
  sql: Sql;
  repository: RoutineRepository;
  appSecret: string;
  verifyToken: string;
}

function verifySignature(input: {
  appSecret: string;
  signature: string | undefined;
  rawBody: string;
}): boolean {
  if (input.signature === undefined || !input.signature.startsWith("sha256="))
    return false;
  const expected = createHmac("sha256", input.appSecret)
    .update(input.rawBody)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(input.signature.slice(7), "utf8");
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

/**
 * WhatsApp Cloud API webhook receiver. Handles both the GET verification
 * handshake (hub.mode=subscribe) and POST message callbacks. The routine id
 * is part of the URL so routing ownership is resolved server-side.
 */
export function registerWhatsAppEventsRoute(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: WhatsAppEventsDependencies,
): void {
  const basePath = "/v1/integrations/whatsapp/events/:routineId";
  const altPath = "/integrations/whatsapp/events/:routineId";

  // Verification handshake
  const verify = async (context: Context<{ Variables: AuthVariables }>) => {
    const mode = context.req.query("hub.mode");
    const token = context.req.query("hub.verify_token");
    const challenge = context.req.query("hub.challenge");
    if (mode !== "subscribe" || token !== dependencies.verifyToken)
      return context.json({ code: "VERIFICATION_FAILED" }, 403);
    return context.text(challenge ?? "", 200);
  };
  app.get(basePath, verify);
  app.get(altPath, verify);

  // Message callback
  const callback = async (context: Context<{ Variables: AuthVariables }>) => {
    const rawBody = await context.req.raw.text();
    if (Buffer.byteLength(rawBody, "utf8") > 256 * 1024)
      return context.json({ code: "PAYLOAD_TOO_LARGE" }, 413);
    if (
      !verifySignature({
        appSecret: dependencies.appSecret,
        signature: context.req.header("x-hub-signature-256"),
        rawBody,
      })
    )
      return context.json({ code: "WHATSAPP_SIGNATURE_INVALID" }, 401);

    let envelope: z.infer<typeof whatsappEnvelopeSchema>;
    try {
      envelope = whatsappEnvelopeSchema.parse(JSON.parse(rawBody));
    } catch {
      return context.json({ code: "INVALID_JSON" }, 400);
    }

    const messages = envelope.entry?.[0]?.changes?.[0]?.value?.messages ?? [];
    if (messages.length === 0)
      return context.json({ accepted: false, reason: "NO_MESSAGES" });

    const routineId = asId<"routine-schedule">(context.req.param("routineId"));
    const [owner] = await dependencies.sql<{ owner_id: string }[]>`
      select owner_id from routine_schedules
      where id=${routineId} and enabled=true
      limit 1
    `;
    if (owner === undefined)
      return context.json({ code: "ROUTINE_NOT_FOUND" }, 404);

    const firstMessage = messages[0];
    if (firstMessage === undefined)
      return context.json({ code: "INVALID_MESSAGE" }, 400);
    const run = await dependencies.repository.queueTrigger(
      asId<"user">(owner.owner_id),
      routineId,
      "whatsapp_message",
      { messages, envelopeObject: envelope.object },
      `whatsapp:${firstMessage.id}`,
    );
    return context.json({ accepted: true, run }, 202);
  };
  app.post(basePath, callback);
  app.post(altPath, callback);
}
