import { describe, expect, it, vi } from "vitest";
import { newId } from "@town/contracts";
import { createGoogleApiClient } from "../src/index.js";

const ownerId = newId<"user">();
const accountId = newId<"connected-account">();
const safe = {
  id: accountId,
  ownerId,
  provider: "google" as const,
  providerUserId: "p",
  email: "owner@example.invalid",
  isPrimary: true,
  isActive: true,
  capabilities: {},
  credentialPresent: true,
  tokenExpiresAt: null,
  needsReauth: false,
  reauthBlockedByOrgPolicy: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function accounts(token = "access-token") {
  return {
    getCredential: vi.fn(async () => ({
      account: safe,
      credential: {
        accessToken: token,
        refreshToken: "refresh",
        scopes: ["openid"],
      },
    })),
  } as never;
}

describe("Google API client", () => {
  it("sends owner-selected Gmail requests with bearer auth", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, options) => {
      expect(options?.headers).toMatchObject({
        authorization: "Bearer access-token",
      });
      return new Response(
        JSON.stringify({ messages: [{ id: "m1", threadId: "t1" }] }),
        { status: 200 },
      );
    });
    const result = await createGoogleApiClient({
      accounts: accounts(),
      fetch,
    }).gmailSearch({ ownerId, accountId, query: "from:boss@example.invalid" });
    expect(result.messages[0]?.id).toBe("m1");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("refreshes once after a provider 401 before retrying", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [] }), { status: 200 }),
      );
    const refresh = vi.fn(async () => safe);
    const result = await createGoogleApiClient({
      accounts: accounts(),
      refresher: { refresh } as never,
      fetch,
    }).gmailSearch({ ownerId, accountId, query: "is:unread" });
    expect(result.messages).toEqual([]);
    expect(refresh).toHaveBeenCalledWith(ownerId, accountId);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("uses POST for Calendar free/busy and validates the response", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, options) => {
      expect(options?.method).toBe("POST");
      return new Response(
        JSON.stringify({ calendars: { primary: { busy: [] } } }),
        { status: 200 },
      );
    });
    const result = await createGoogleApiClient({
      accounts: accounts(),
      fetch,
    }).calendarFreeBusy({
      ownerId,
      accountId,
      timeMin: "2026-08-04T00:00:00Z",
      timeMax: "2026-08-05T00:00:00Z",
    });
    expect(result.calendars["primary"]?.busy).toEqual([]);
  });

  it("retrieves one Gmail message with full format", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
      expect(String(url)).toContain("messages/message-1");
      return new Response(
        JSON.stringify({ id: "message-1", threadId: "thread-1", payload: {} }),
        { status: 200 },
      );
    });
    const result = await createGoogleApiClient({
      accounts: accounts(),
      fetch,
    }).gmailGetMessage({ ownerId, accountId, messageId: "message-1" });
    expect(result.threadId).toBe("thread-1");
  });

  it("creates a Calendar event with a provider write request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, options) => {
      expect(options?.method).toBe("POST");
      expect(JSON.parse(String(options?.body))).toMatchObject({
        summary: "Focus",
      });
      return new Response(
        JSON.stringify({ id: "event-1", status: "confirmed" }),
        { status: 200 },
      );
    });
    const result = await createGoogleApiClient({
      accounts: accounts(),
      fetch,
    }).calendarCreateEvent({
      ownerId,
      accountId,
      calendarId: "primary",
      event: { summary: "Focus" },
    });
    expect(result.id).toBe("event-1");
  });
});
