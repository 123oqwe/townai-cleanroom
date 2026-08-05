import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Sql } from "postgres";
import { asId } from "@town/contracts";
import type { GoogleApiClient } from "@town/google";
import type { RoutineRepository } from "@town/routines";
import { registerGmailPubsubEventsRoute } from "../src/routes/gmail-pubsub-events.js";
import type { AuthVariables } from "../src/lib/auth.js";
import {
  generateSignedOidcToken,
  generateJwksResponse,
  generateKeyPairForTest,
  type TestKeyPair,
} from "./helpers/oidc-test-keys.js";

const clientId = "test-google-client-id";
const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");
const routineScheduleId = asId<"routine-schedule">(
  "01900000-0000-7000-8000-000000000010",
);
const accountId = asId<"connected-account">(
  "01900000-0000-7000-8000-000000000020",
);

function mockGoogle(): GoogleApiClient {
  return {
    gmailListHistory: vi.fn(async () => ({
      history: [
        {
          id: "hist-1",
          type: "messageAdded",
          messages: [{ id: "msg-1", threadId: "thread-1" }],
        },
      ],
      historyId: "1234567",
    })),
    gmailGetMessage: vi.fn(async () => ({
      id: "msg-1",
      threadId: "thread-1",
      labelIds: ["INBOX"],
      payload: { headers: [{ name: "Subject", value: "Test" }] },
    })),
  } as unknown as GoogleApiClient;
}

function mockSql(emailAddress: string): Sql {
  return (async () => [
    {
      owner_id: ownerId,
      routine_schedule_id: routineScheduleId,
      account_id: accountId,
      assistant_address: emailAddress,
    },
  ]) as unknown as Sql;
}

function mockRepository() {
  const queueTrigger = vi.fn(async (...args: unknown[]) => ({
    id: "run-1",
    args,
  }));
  return {
    repository: { queueTrigger } as unknown as RoutineRepository,
    queueTrigger,
  };
}

function encodePayload(historyId: string, emailAddress: string): string {
  return Buffer.from(
    JSON.stringify({ historyId, emailAddress }),
    "utf8",
  ).toString("base64");
}

function buildApp(options: {
  google?: GoogleApiClient;
  sql?: Sql;
  repository?: RoutineRepository;
  clientId?: string;
  fetchImpl?: typeof globalThis.fetch;
}) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const google = options.google ?? mockGoogle();
  const sql = options.sql ?? mockSql("assistant@test.invalid");
  const repo = options.repository ?? mockRepository().repository;
  registerGmailPubsubEventsRoute(app, {
    sql,
    repository: repo,
    google,
    ...(options.clientId === undefined ? {} : { clientId: options.clientId }),
    ...(options.fetchImpl === undefined ? {} : { fetch: options.fetchImpl }),
  });
  return app;
}

async function buildFetchWithJwks(keyPair: TestKeyPair) {
  const jwksResponse = generateJwksResponse(keyPair);
  return vi.fn<typeof globalThis.fetch>(async (url) => {
    if (url === "https://www.googleapis.com/oauth2/v3/certs") {
      return new Response(JSON.stringify(jwksResponse), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  });
}

describe("Gmail Pub/Sub push endpoint", () => {
  it("creates a RoutineRun for a valid OIDC token and matching routine", async () => {
    const keyPair = await generateKeyPairForTest();
    const fetchImpl = await buildFetchWithJwks(keyPair);
    const token = await generateSignedOidcToken({
      keyPair,
      clientId,
      email: "assistant@test.invalid",
    });
    const { repository, queueTrigger } = mockRepository();
    const app = buildApp({
      repository,
      clientId,
      fetchImpl,
    });
    const body = JSON.stringify({
      message: {
        data: encodePayload("1234567", "assistant@test.invalid"),
        messageId: "msg-envelope-1",
      },
      subscription: "projects/test/subscriptions/gmail-push",
    });
    const response = await app.request(
      "http://town.test/v1/internal/gmail/pubsub",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body,
      },
    );
    expect(response.status).toBe(202);
    const json = await response.json();
    expect(json).toEqual({ accepted: true, queued: 1 });
    expect(queueTrigger).toHaveBeenCalledOnce();
    const callArgs = queueTrigger.mock.calls[0] ?? [];
    expect(callArgs[0]).toBe(ownerId);
    expect(callArgs[1]).toBe(routineScheduleId);
    expect(callArgs[2]).toBe("email_to_assistant");
    const triggerData = callArgs[3] as Record<string, unknown>;
    expect(triggerData["messageId"]).toBe("msg-1");
    expect(triggerData["emailAddress"]).toBe("assistant@test.invalid");
    expect(triggerData["historyId"]).toBe("1234567");
    expect(callArgs[4]).toBe(`gmail-pubsub:${accountId}:msg-1`);
    expect(callArgs[5]).toBe(accountId);
  });

  it("returns 401 for an invalid or missing OIDC token", async () => {
    const keyPair = await generateKeyPairForTest();
    const fetchImpl = await buildFetchWithJwks(keyPair);
    const app = buildApp({ clientId, fetchImpl });
    const body = JSON.stringify({
      message: { data: encodePayload("1", "assistant@test.invalid") },
    });
    const responseNoAuth = await app.request(
      "http://town.test/v1/internal/gmail/pubsub",
      { method: "POST", headers: { "content-type": "application/json" }, body },
    );
    expect(responseNoAuth.status).toBe(401);

    const responseBadToken = await app.request(
      "http://town.test/v1/internal/gmail/pubsub",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer not-a-jwt",
        },
        body,
      },
    );
    expect(responseBadToken.status).toBe(401);
  });

  it("returns 200 silently when no routine matches the email address", async () => {
    const keyPair = await generateKeyPairForTest();
    const fetchImpl = await buildFetchWithJwks(keyPair);
    const token = await generateSignedOidcToken({
      keyPair,
      clientId,
      email: "someone-else@test.invalid",
    });
    const sql = (async () => [
      {
        owner_id: ownerId,
        routine_schedule_id: routineScheduleId,
        account_id: accountId,
        assistant_address: "assistant@test.invalid",
      },
    ]) as unknown as Sql;
    const { repository, queueTrigger } = mockRepository();
    const app = buildApp({
      google: mockGoogle(),
      sql,
      repository,
      clientId,
      fetchImpl,
    });
    const body = JSON.stringify({
      message: {
        data: encodePayload("1234567", "someone-else@test.invalid"),
      },
    });
    const response = await app.request(
      "http://town.test/v1/internal/gmail/pubsub",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body,
      },
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ accepted: false, reason: "NO_MATCHING_ROUTINE" });
    expect(queueTrigger).not.toHaveBeenCalled();
  });

  it("returns not_configured when GOOGLE_OAUTH_CLIENT_ID is absent", async () => {
    const app = buildApp({});
    const response = await app.request(
      "http://town.test/v1/internal/gmail/pubsub",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(response.status).toBe(503);
    const json = await response.json();
    expect(json).toEqual({ code: "GMAIL_PUBSUB_NOT_CONFIGURED" });
  });
});
