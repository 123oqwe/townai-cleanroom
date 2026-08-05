import { z } from "zod";
import type { Id } from "@town/contracts";
import type { AccountRepository, GoogleTokenRefresher } from "@town/identity";

const gmailSearchSchema = z
  .object({
    messages: z
      .array(z.object({ id: z.string(), threadId: z.string() }).passthrough())
      .default([]),
    nextPageToken: z.string().optional(),
    resultSizeEstimate: z.number().optional(),
  })
  .passthrough();
const gmailMessageSchema = z
  .object({
    id: z.string(),
    threadId: z.string(),
    labelIds: z.array(z.string()).optional(),
    payload: z.record(z.string(), z.json()).optional(),
  })
  .passthrough();
const gmailSentSchema = z
  .object({
    id: z.string(),
    threadId: z.string().optional(),
    labelIds: z.array(z.string()).optional(),
  })
  .passthrough();
const calendarEventSchema = z
  .object({
    id: z.string().optional(),
    status: z.string().optional(),
    htmlLink: z.string().optional(),
  })
  .passthrough();
const calendarEventsSchema = z
  .object({
    items: z.array(calendarEventSchema).default([]),
    nextPageToken: z.string().optional(),
  })
  .passthrough();
const calendarListSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string(),
            summary: z.string().optional(),
            summaryOverride: z.string().optional(),
            primary: z.boolean().optional(),
            selected: z.boolean().optional(),
            hidden: z.boolean().optional(),
          })
          .passthrough(),
      )
      .default([]),
    nextPageToken: z.string().optional(),
  })
  .passthrough();
const gmailWatchSchema = z
  .object({
    historyId: z.string(),
    expiration: z.string().optional(),
  })
  .passthrough();
const gmailHistorySchema = z
  .object({
    history: z
      .array(
        z
          .object({
            id: z.string().optional(),
            type: z.string().optional(),
            messageId: z.string().optional(),
            threadId: z.string().optional(),
            messages: z
              .array(
                z
                  .object({ id: z.string(), threadId: z.string() })
                  .passthrough(),
              )
              .optional(),
            labelsAdded: z.array(z.record(z.string(), z.json())).optional(),
            labelsRemoved: z.array(z.record(z.string(), z.json())).optional(),
          })
          .passthrough(),
      )
      .default([]),
    nextPageToken: z.string().optional(),
    historyId: z.string().optional(),
  })
  .passthrough();
const freeBusySchema = z
  .object({
    calendars: z.record(
      z.string(),
      z
        .object({
          busy: z
            .array(
              z.object({ start: z.string(), end: z.string() }).passthrough(),
            )
            .default([]),
          errors: z.array(z.unknown()).optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

import { GoogleApiError } from "./types.js";

export function createGoogleApiClient(input: {
  accounts: AccountRepository;
  refresher?: GoogleTokenRefresher;
  fetch?: typeof globalThis.fetch;
}) {
  const request = input.fetch ?? globalThis.fetch;
  if (request === undefined)
    throw new GoogleApiError("GOOGLE_API_HTTP", "Fetch is unavailable.");
  async function accessToken(
    ownerId: Id<"user">,
    accountId: Id<"connected-account">,
  ) {
    const loaded = await input.accounts.getCredential(ownerId, accountId);
    if (loaded.account.provider !== "google")
      throw new GoogleApiError(
        "GOOGLE_API_NOT_GOOGLE",
        "The connected account is not Google.",
      );
    if (
      loaded.account.tokenExpiresAt !== null &&
      loaded.account.tokenExpiresAt.getTime() <= Date.now() + 60_000 &&
      input.refresher !== undefined
    ) {
      await input.refresher.refresh(ownerId, accountId);
      return (await input.accounts.getCredential(ownerId, accountId)).credential
        .accessToken;
    }
    return loaded.credential.accessToken;
  }
  async function json<T>(
    ownerId: Id<"user">,
    accountId: Id<"connected-account">,
    url: string,
    schema: z.ZodType<T>,
    retried = false,
  ): Promise<T> {
    const response = await request(url, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${await accessToken(ownerId, accountId)}`,
      },
    });
    if (response.status === 401 && !retried && input.refresher !== undefined) {
      await input.refresher.refresh(ownerId, accountId);
      return json(ownerId, accountId, url, schema, true);
    }
    if (!response.ok)
      throw new GoogleApiError(
        "GOOGLE_API_HTTP",
        `Google API returned HTTP ${response.status}.`,
        response.status,
      );
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success)
      throw new GoogleApiError(
        "GOOGLE_API_INVALID",
        "Google API returned an unexpected response.",
      );
    return parsed.data;
  }
  return {
    async calendarListCalendars(input_: {
      ownerId: Id<"user">;
      accountId: Id<"connected-account">;
      maxResults?: number;
      pageToken?: string;
    }) {
      const params = new URLSearchParams({
        maxResults: String(input_.maxResults ?? 100),
      });
      if (input_.pageToken !== undefined)
        params.set("pageToken", input_.pageToken);
      return json(
        input_.ownerId,
        input_.accountId,
        `https://www.googleapis.com/calendar/v3/users/me/calendarList?${params}`,
        calendarListSchema,
      );
    },
    async gmailSearch(input_: {
      ownerId: Id<"user">;
      accountId: Id<"connected-account">;
      query: string;
      maxResults?: number;
    }) {
      const params = new URLSearchParams({
        q: input_.query,
        maxResults: String(input_.maxResults ?? 10),
      });
      return json(
        input_.ownerId,
        input_.accountId,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
        gmailSearchSchema,
      );
    },
    async gmailGetMessage(input_: {
      ownerId: Id<"user">;
      accountId: Id<"connected-account">;
      messageId: string;
    }) {
      return json(
        input_.ownerId,
        input_.accountId,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(input_.messageId)}?format=full`,
        gmailMessageSchema,
      );
    },
    async gmailSend(
      input_: {
        ownerId: Id<"user">;
        accountId: Id<"connected-account">;
        to: string;
        cc?: string[];
        subject: string;
        body: string;
      },
      retried = false,
    ): Promise<z.infer<typeof gmailSentSchema>> {
      const fields = [input_.to, input_.subject, ...(input_.cc ?? [])];
      if (fields.some((field) => /[\r\n]/.test(field)))
        throw new GoogleApiError(
          "GOOGLE_API_INVALID",
          "Email headers and body must not contain raw CR/LF header injection.",
        );
      const raw = [
        `To: ${input_.to}`,
        ...(input_.cc === undefined || input_.cc.length === 0
          ? []
          : [`Cc: ${input_.cc.join(", ")}`]),
        `Subject: ${input_.subject}`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=UTF-8",
        "",
        input_.body,
      ].join("\r\n");
      const response = await request(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            authorization: `Bearer ${await accessToken(input_.ownerId, input_.accountId)}`,
          },
          body: JSON.stringify({
            raw: Buffer.from(raw, "utf8").toString("base64url"),
          }),
        },
      );
      if (
        response.status === 401 &&
        !retried &&
        input.refresher !== undefined
      ) {
        await input.refresher.refresh(input_.ownerId, input_.accountId);
        return this.gmailSend(input_, true);
      }
      if (!response.ok)
        throw new GoogleApiError(
          "GOOGLE_API_HTTP",
          `Gmail API returned HTTP ${response.status}.`,
          response.status,
        );
      const parsed = gmailSentSchema.safeParse(await response.json());
      if (!parsed.success)
        throw new GoogleApiError(
          "GOOGLE_API_INVALID",
          "Gmail returned an unexpected send response.",
        );
      return parsed.data;
    },
    async gmailWatch(input_: {
      ownerId: Id<"user">;
      accountId: Id<"connected-account">;
      topicName: string;
      labelIds?: string[];
    }): Promise<z.infer<typeof gmailWatchSchema>> {
      const response = await request(
        "https://gmail.googleapis.com/gmail/v1/users/me/watch",
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            authorization: `Bearer ${await accessToken(input_.ownerId, input_.accountId)}`,
          },
          body: JSON.stringify({
            topicName: input_.topicName,
            labelIds: input_.labelIds ?? ["INBOX"],
          }),
        },
      );
      if (!response.ok)
        throw new GoogleApiError(
          "GOOGLE_API_HTTP",
          `Gmail API returned HTTP ${response.status}.`,
          response.status,
        );
      const parsed = gmailWatchSchema.safeParse(await response.json());
      if (!parsed.success)
        throw new GoogleApiError(
          "GOOGLE_API_INVALID",
          "Gmail returned an unexpected watch response.",
        );
      return parsed.data;
    },
    async gmailListHistory(input_: {
      ownerId: Id<"user">;
      accountId: Id<"connected-account">;
      startHistoryId: string;
      maxResults?: number;
      pageToken?: string;
    }): Promise<z.infer<typeof gmailHistorySchema>> {
      const params = new URLSearchParams({
        startHistoryId: input_.startHistoryId,
      });
      if (input_.maxResults !== undefined)
        params.set("maxResults", String(input_.maxResults));
      if (input_.pageToken !== undefined)
        params.set("pageToken", input_.pageToken);
      return json(
        input_.ownerId,
        input_.accountId,
        `https://gmail.googleapis.com/gmail/v1/users/me/history?${params}`,
        gmailHistorySchema,
      );
    },
    async calendarFreeBusy(input_: {
      ownerId: Id<"user">;
      accountId: Id<"connected-account">;
      timeMin: string;
      timeMax: string;
      calendarIds?: string[];
    }) {
      const response = await request(
        "https://www.googleapis.com/calendar/v3/freeBusy",
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            authorization: `Bearer ${await accessToken(input_.ownerId, input_.accountId)}`,
          },
          body: JSON.stringify({
            timeMin: input_.timeMin,
            timeMax: input_.timeMax,
            items: (input_.calendarIds ?? ["primary"]).map((id) => ({ id })),
          }),
        },
      );
      if (!response.ok)
        throw new GoogleApiError(
          "GOOGLE_API_HTTP",
          `Google Calendar API returned HTTP ${response.status}.`,
          response.status,
        );
      const parsed = freeBusySchema.safeParse(await response.json());
      if (!parsed.success)
        throw new GoogleApiError(
          "GOOGLE_API_INVALID",
          "Google Calendar returned an unexpected response.",
        );
      return parsed.data;
    },
    async calendarListEvents(input_: {
      ownerId: Id<"user">;
      accountId: Id<"connected-account">;
      calendarId: string;
      timeMin: string;
      timeMax: string;
      maxResults?: number;
      pageToken?: string;
    }) {
      const params = new URLSearchParams({
        timeMin: input_.timeMin,
        timeMax: input_.timeMax,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: String(input_.maxResults ?? 100),
      });
      if (input_.pageToken !== undefined)
        params.set("pageToken", input_.pageToken);
      return json(
        input_.ownerId,
        input_.accountId,
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input_.calendarId)}/events?${params}`,
        calendarEventsSchema,
      );
    },
    async calendarCreateEvent(
      input_: {
        ownerId: Id<"user">;
        accountId: Id<"connected-account">;
        calendarId: string;
        event: Record<string, unknown>;
      },
      retried = false,
    ): Promise<z.infer<typeof calendarEventSchema>> {
      const response = await request(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input_.calendarId)}/events`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            authorization: `Bearer ${await accessToken(input_.ownerId, input_.accountId)}`,
          },
          body: JSON.stringify(input_.event),
        },
      );
      if (
        response.status === 401 &&
        !retried &&
        input.refresher !== undefined
      ) {
        await input.refresher.refresh(input_.ownerId, input_.accountId);
        return this.calendarCreateEvent(input_, true);
      }
      if (!response.ok)
        throw new GoogleApiError(
          "GOOGLE_API_HTTP",
          `Google Calendar API returned HTTP ${response.status}.`,
          response.status,
        );
      const parsed = calendarEventSchema.safeParse(await response.json());
      if (!parsed.success)
        throw new GoogleApiError(
          "GOOGLE_API_INVALID",
          "Google Calendar returned an unexpected event response.",
        );
      return parsed.data;
    },
  };
}
export type GoogleApiClient = ReturnType<typeof createGoogleApiClient>;
