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
const calendarEventSchema = z
  .object({
    id: z.string().optional(),
    status: z.string().optional(),
    htmlLink: z.string().optional(),
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

export class GoogleApiError extends Error {
  constructor(
    readonly code:
      "GOOGLE_API_NOT_GOOGLE" | "GOOGLE_API_HTTP" | "GOOGLE_API_INVALID",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

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
