import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { Sql } from "postgres";
import { asId } from "@town/contracts";
import type { RoutineRepository } from "@town/routines";
import type { AuthVariables } from "./auth.js";

const slackEnvelopeSchema = z
  .object({
    type: z.string(),
    challenge: z.string().optional(),
    event_id: z.string().trim().min(1).max(200).optional(),
    event: z.record(z.string(), z.json()).optional(),
  })
  .passthrough();

export interface SlackSignatureResult {
  valid: boolean;
  reason?: "missing_headers" | "stale" | "invalid";
}

/** Verify Slack's v0 signing secret against the exact raw request body. */
export function verifySlackSignature(input: {
  signingSecret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): SlackSignatureResult {
  if (input.timestamp === undefined || input.signature === undefined)
    return { valid: false, reason: "missing_headers" };
  const timestamp = Number(input.timestamp);
  if (!Number.isInteger(timestamp)) return { valid: false, reason: "invalid" };
  const tolerance = input.toleranceSeconds ?? 300;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > tolerance)
    return { valid: false, reason: "stale" };
  const expected = `v0=${createHmac("sha256", input.signingSecret)
    .update(`v0:${input.timestamp}:${input.rawBody}`)
    .digest("hex")}`;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(input.signature, "utf8");
  return expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
    ? { valid: true }
    : { valid: false, reason: "invalid" };
}

export interface SlackEventsDependencies {
  sql: Sql;
  repository: RoutineRepository;
  signingSecret: string;
}

/**
 * Receives Slack Events API callbacks for one installed routine. The routine
 * id is deliberately part of the endpoint: routing ownership is resolved
 * server-side and the event is queued with Slack's durable event_id.
 */
export function registerSlackEventsRoute(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: SlackEventsDependencies,
): void {
  const route = async (context: Context<{ Variables: AuthVariables }>) => {
    const rawBody = await context.req.raw.text();
    if (Buffer.byteLength(rawBody, "utf8") > 256 * 1024)
      return context.json({ code: "PAYLOAD_TOO_LARGE" }, 413);
    const verified = verifySlackSignature({
      signingSecret: dependencies.signingSecret,
      timestamp: context.req.header("x-slack-request-timestamp"),
      signature: context.req.header("x-slack-signature"),
      rawBody,
    });
    if (!verified.valid)
      return context.json({ code: "SLACK_SIGNATURE_INVALID" }, 401);
    let body: z.infer<typeof slackEnvelopeSchema>;
    try {
      body = slackEnvelopeSchema.parse(JSON.parse(rawBody));
    } catch {
      return context.json({ code: "INVALID_JSON" }, 400);
    }
    if (body.type === "url_verification" && body.challenge !== undefined)
      return context.json({ challenge: body.challenge });
    if (body.type !== "event_callback" || body.event_id === undefined)
      return context.json({ code: "UNSUPPORTED_EVENT" }, 400);
    const event = body.event;
    if (event === undefined || event["type"] !== "app_mention")
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
      "slack_mention",
      { event, eventId: body.event_id, envelopeType: body.type },
      `slack:${body.event_id}`,
    );
    return context.json({ accepted: true, run }, 202);
  };

  app.post("/v1/integrations/slack/events/:routineId", route);
  app.post("/integrations/slack/events/:routineId", route);
}
