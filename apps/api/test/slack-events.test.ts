import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Sql } from "postgres";
import { asId } from "@town/contracts";
import type { RoutineRepository } from "@town/routines";
import {
  registerSlackEventsRoute,
  verifySlackSignature,
} from "../src/webhooks/slack-events.js";
import type { AuthVariables } from "../src/lib/auth.js";

const secret = "slack-signing-secret";
const routineId = "01900000-0000-7000-8000-000000000004";
const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");

function signedHeaders(
  body: string,
  timestamp = String(Math.floor(Date.now() / 1000)),
) {
  const signature = `v0=${createHmac("sha256", secret)
    .update(`v0:${timestamp}:${body}`)
    .digest("hex")}`;
  return {
    "content-type": "application/json",
    "x-slack-request-timestamp": timestamp,
    "x-slack-signature": signature,
  };
}

function signatureFor(body: string, timestamp = "1700000000") {
  return signedHeaders(body, timestamp)["x-slack-signature"];
}

describe("Slack Events API adapter", () => {
  it("verifies the exact raw body and rejects stale requests", () => {
    const rawBody = '{"type":"event_callback"}';
    expect(
      verifySlackSignature({
        signingSecret: secret,
        timestamp: "1700000000",
        signature: signatureFor(rawBody),
        rawBody,
        nowSeconds: 1700000100,
      }),
    ).toEqual({ valid: true });
    expect(
      verifySlackSignature({
        signingSecret: secret,
        timestamp: "1700000000",
        signature: signatureFor(rawBody),
        rawBody,
        nowSeconds: 1700000401,
      }),
    ).toMatchObject({ valid: false, reason: "stale" });
  });

  it("answers URL verification and queues app mentions idempotently", async () => {
    const sql = (async () => [{ owner_id: ownerId }]) as unknown as Sql;
    const queueTrigger = vi.fn(async (...args: unknown[]) => ({
      id: "run-1",
      args,
    }));
    const repository = { queueTrigger } as unknown as RoutineRepository;
    const app = new Hono<{ Variables: AuthVariables }>();
    registerSlackEventsRoute(app, { sql, repository, signingSecret: secret });

    const challenge = JSON.stringify({
      type: "url_verification",
      challenge: "abc",
    });
    const challengeResponse = await app.request(
      `http://town.test/v1/integrations/slack/events/${routineId}`,
      { method: "POST", headers: signedHeaders(challenge), body: challenge },
    );
    expect(challengeResponse.status).toBe(200);
    await expect(challengeResponse.json()).resolves.toEqual({
      challenge: "abc",
    });

    const event = JSON.stringify({
      type: "event_callback",
      event_id: "Ev123",
      event: { type: "app_mention", text: "hello", channel: "C1" },
    });
    const response = await app.request(
      `http://town.test/v1/integrations/slack/events/${routineId}`,
      { method: "POST", headers: signedHeaders(event), body: event },
    );
    expect(response.status).toBe(202);
    expect(queueTrigger).toHaveBeenCalledWith(
      ownerId,
      asId<"routine-schedule">(routineId),
      "slack_mention",
      {
        event: { type: "app_mention", text: "hello", channel: "C1" },
        eventId: "Ev123",
        envelopeType: "event_callback",
      },
      "slack:Ev123",
    );
  });

  it("accepts legacy Slack callback path without v1", async () => {
    const sql = (async () => [{ owner_id: ownerId }]) as unknown as Sql;
    const queueTrigger = vi.fn(async (...args: unknown[]) => ({
      id: "run-legacy",
      args,
    }));
    const repository = { queueTrigger } as unknown as RoutineRepository;
    const app = new Hono<{ Variables: AuthVariables }>();
    registerSlackEventsRoute(app, { sql, repository, signingSecret: secret });

    const event = JSON.stringify({
      type: "event_callback",
      event_id: "EvLegacy",
      event: { type: "app_mention", text: "legacy", channel: "C2" },
    });
    const response = await app.request(
      `http://town.test/integrations/slack/events/${routineId}`,
      { method: "POST", headers: signedHeaders(event), body: event },
    );
    expect(response.status).toBe(202);
    expect(queueTrigger).toHaveBeenCalledWith(
      ownerId,
      asId<"routine-schedule">(routineId),
      "slack_mention",
      {
        event: { type: "app_mention", text: "legacy", channel: "C2" },
        eventId: "EvLegacy",
        envelopeType: "event_callback",
      },
      "slack:EvLegacy",
    );
  });
});
