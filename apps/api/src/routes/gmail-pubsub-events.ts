import type { Context, Hono } from "hono";
import { z } from "zod";
import type { Sql } from "postgres";
import { asId, type Id } from "@town/contracts";
import type { GoogleApiClient } from "@town/google";
import type { RoutineRepository } from "@town/routines";
import type { AuthVariables } from "../lib/auth.js";
import { verifyGoogleOidcToken } from "../lib/google-oidc.js";

const pubsubMessageSchema = z
  .object({
    message: z
      .object({
        data: z.string(),
        messageId: z.string().optional(),
        publishTime: z.string().optional(),
        attributes: z.record(z.string(), z.string()).optional(),
      })
      .passthrough(),
    subscription: z.string().optional(),
  })
  .passthrough();

const decodedPayloadSchema = z
  .object({
    historyId: z.string(),
    emailAddress: z.string().email(),
  })
  .passthrough();

export interface GmailPubsubDependencies {
  sql: Sql;
  repository: RoutineRepository;
  google: GoogleApiClient;
  clientId?: string;
  fetch?: typeof globalThis.fetch;
}

interface EmailTriggerMatch {
  ownerId: Id<"user">;
  routineScheduleId: Id<"routine-schedule">;
  accountId: Id<"connected-account">;
}

/**
 * Gmail Pub/Sub push endpoint. Google sends a push notification containing
 * a base64-encoded payload with `{ historyId, emailAddress }`. The endpoint
 * verifies the Google OIDC JWT in the Authorization header, fetches new
 * messages via the Gmail History API, matches the email address to a
 * routine's `email_to_assistant` trigger, and queues a RoutineRun.
 *
 * Unmatched emails return 200 silently to avoid Google retry storms.
 */
export function registerGmailPubsubEventsRoute(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: GmailPubsubDependencies,
): void {
  const route = async (context: Context<{ Variables: AuthVariables }>) => {
    if (dependencies.clientId === undefined)
      return context.json({ code: "GMAIL_PUBSUB_NOT_CONFIGURED" }, 503);

    const authHeader = context.req.header("authorization");
    if (authHeader === undefined || !authHeader.startsWith("Bearer "))
      return context.json({ code: "GMAIL_PUBSUB_UNAUTHORIZED" }, 401);

    const token = authHeader.slice("Bearer ".length).trim();
    if (token.length === 0)
      return context.json({ code: "GMAIL_PUBSUB_UNAUTHORIZED" }, 401);

    try {
      await verifyGoogleOidcToken({
        token,
        clientId: dependencies.clientId,
        ...(dependencies.fetch === undefined
          ? {}
          : { fetch: dependencies.fetch }),
      });
    } catch {
      return context.json({ code: "GMAIL_PUBSUB_UNAUTHORIZED" }, 401);
    }

    const rawBody = await context.req.raw.text();
    if (Buffer.byteLength(rawBody, "utf8") > 256 * 1024)
      return context.json({ code: "PAYLOAD_TOO_LARGE" }, 413);

    let envelope: z.infer<typeof pubsubMessageSchema>;
    try {
      envelope = pubsubMessageSchema.parse(JSON.parse(rawBody));
    } catch {
      return context.json({ code: "INVALID_JSON" }, 400);
    }

    let payload: z.infer<typeof decodedPayloadSchema>;
    try {
      const decoded = Buffer.from(envelope.message.data, "base64").toString(
        "utf8",
      );
      payload = decodedPayloadSchema.parse(JSON.parse(decoded));
    } catch {
      return context.json({ accepted: false, reason: "INVALID_PAYLOAD" }, 200);
    }

    const match = await findEmailTrigger(
      dependencies.sql,
      payload.emailAddress,
    );
    if (match === null)
      return context.json(
        { accepted: false, reason: "NO_MATCHING_ROUTINE" },
        200,
      );

    const messages = await fetchNewMessages(
      dependencies.google,
      match,
      payload.historyId,
    );

    if (messages.length === 0)
      return context.json({ accepted: false, reason: "NO_NEW_MESSAGES" }, 200);

    const queued: string[] = [];
    for (const message of messages) {
      try {
        const detail = await dependencies.google.gmailGetMessage({
          ownerId: match.ownerId,
          accountId: match.accountId,
          messageId: message.id,
        });
        const run = await dependencies.repository.queueTrigger(
          match.ownerId,
          match.routineScheduleId,
          "email_to_assistant",
          {
            provider: "google_gmail",
            accountId: match.accountId,
            messageId: message.id,
            threadId: message.threadId,
            emailAddress: payload.emailAddress,
            historyId: payload.historyId,
            labels: detail.labelIds ?? [],
            payload: detail.payload ?? null,
          },
          `gmail-pubsub:${match.accountId}:${message.id}`,
          match.accountId,
        );
        queued.push(run.id);
      } catch {
        // Idempotency guard: duplicate deliveries are expected from Pub/Sub.
      }
    }

    return context.json({ accepted: true, queued: queued.length }, 202);
  };

  app.post("/v1/internal/gmail/pubsub", route);
}

async function findEmailTrigger(
  sql: Sql,
  emailAddress: string,
): Promise<EmailTriggerMatch | null> {
  const rows = await sql<
    {
      owner_id: string;
      routine_schedule_id: string;
      account_id: string;
      assistant_address: string | null;
    }[]
  >`
    select t.owner_id, t.routine_schedule_id, ca.id as account_id,
           t.config->>'assistantAddress' as assistant_address
    from routine_triggers t
    join routine_schedules s
      on s.owner_id=t.owner_id and s.id=t.routine_schedule_id and s.enabled=true
    join connected_accounts ca
      on ca.owner_id=t.owner_id and ca.provider='google' and ca.is_active=true
     and (
       t.config->>'accountId'=ca.id::text
       or (t.config->>'accountId' is null and ca.is_primary=true)
     )
    where t.enabled=true and t.kind='email_to_assistant'
    order by t.updated_at, t.id limit 100
  `;
  const normalized = emailAddress.trim().toLowerCase();
  for (const row of rows) {
    const assistantAddress = (row.assistant_address ?? "").trim().toLowerCase();
    if (assistantAddress.length > 0 && assistantAddress === normalized)
      return {
        ownerId: asId<"user">(row.owner_id),
        routineScheduleId: asId<"routine-schedule">(row.routine_schedule_id),
        accountId: asId<"connected-account">(row.account_id),
      };
  }
  return null;
}

interface HistoryMessage {
  id: string;
  threadId: string;
}

async function fetchNewMessages(
  google: GoogleApiClient,
  match: EmailTriggerMatch,
  historyId: string,
): Promise<HistoryMessage[]> {
  const collected: HistoryMessage[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;
  const maxPages = 5;
  for (let page = 0; page < maxPages; page++) {
    const history = await google.gmailListHistory({
      ownerId: match.ownerId,
      accountId: match.accountId,
      startHistoryId: historyId,
      maxResults: 50,
      ...(pageToken === undefined ? {} : { pageToken }),
    });
    for (const entry of history.history) {
      if (entry.messageId !== undefined && entry.threadId !== undefined) {
        if (!seen.has(entry.messageId)) {
          seen.add(entry.messageId);
          collected.push({ id: entry.messageId, threadId: entry.threadId });
        }
      }
      const messages = entry.messages ?? [];
      for (const msg of messages) {
        if (!seen.has(msg.id)) {
          seen.add(msg.id);
          collected.push({ id: msg.id, threadId: msg.threadId });
        }
      }
    }
    if (history.nextPageToken === undefined) break;
    pageToken = history.nextPageToken;
  }
  return collected;
}
