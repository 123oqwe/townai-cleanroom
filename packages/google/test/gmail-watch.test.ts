import { describe, expect, it, vi } from "vitest";
import { newId } from "@town/contracts";
import {
  createGoogleApiClient,
  createGmailWatchManager,
} from "../src/index.js";

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

describe("Gmail watch manager", () => {
  it("calls users.watch with the correct topic and INBOX label", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, options) => {
      expect(String(url)).toBe(
        "https://gmail.googleapis.com/gmail/v1/users/me/watch",
      );
      expect(options?.method).toBe("POST");
      const body = JSON.parse(String(options?.body));
      expect(body).toEqual({
        topicName: "projects/test/topics/gmail-inbox",
        labelIds: ["INBOX"],
      });
      return new Response(
        JSON.stringify({
          historyId: "1234567",
          expiration: "1234567890000",
        }),
        { status: 200 },
      );
    });
    const google = createGoogleApiClient({ accounts: accounts(), fetch });
    const manager = createGmailWatchManager({
      google,
      topicName: "projects/test/topics/gmail-inbox",
    });
    const result = await manager.startWatch({ ownerId, accountId });
    expect(result).toEqual({
      status: "configured",
      historyId: "1234567",
      expiration: "1234567890000",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("returns not_configured when topicName is absent", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const google = createGoogleApiClient({ accounts: accounts(), fetch });
    const manager = createGmailWatchManager({ google });
    const result = await manager.startWatch({ ownerId, accountId });
    expect(result).toEqual({ status: "not_configured" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renewWatch delegates to the same Gmail watch call", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      return new Response(
        JSON.stringify({ historyId: "999", expiration: "9999999999999" }),
        { status: 200 },
      );
    });
    const google = createGoogleApiClient({ accounts: accounts(), fetch });
    const manager = createGmailWatchManager({
      google,
      topicName: "projects/test/topics/gmail-inbox",
    });
    const result = await manager.renewWatch({ ownerId, accountId });
    expect(result.status).toBe("configured");
    expect(result.historyId).toBe("999");
  });

  it("renewAll skips when topicName is absent", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const google = createGoogleApiClient({ accounts: accounts(), fetch });
    const manager = createGmailWatchManager({ google });
    const listAccounts = vi.fn(async () => [{ ownerId, accountId }]);
    const result = await manager.renewAll(listAccounts);
    expect(result).toEqual({
      status: "not_configured",
      renewed: 0,
      failed: 0,
    });
    expect(listAccounts).not.toHaveBeenCalled();
  });

  it("renewAll renews all accounts and counts failures", async () => {
    let callCount = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      callCount += 1;
      if (callCount === 2) {
        return new Response("error", { status: 500 });
      }
      return new Response(JSON.stringify({ historyId: "h", expiration: "e" }), {
        status: 200,
      });
    });
    const google = createGoogleApiClient({ accounts: accounts(), fetch });
    const manager = createGmailWatchManager({
      google,
      topicName: "projects/test/topics/gmail-inbox",
    });
    const secondOwner = newId<"user">();
    const secondAccount = newId<"connected-account">();
    const listAccounts = vi.fn(async () => [
      { ownerId, accountId },
      { ownerId: secondOwner, accountId: secondAccount },
    ]);
    const result = await manager.renewAll(listAccounts);
    expect(result.status).toBe("configured");
    expect(result.renewed).toBe(1);
    expect(result.failed).toBe(1);
  });
});
