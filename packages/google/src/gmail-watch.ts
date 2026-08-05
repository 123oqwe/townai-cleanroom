import type { Id } from "@town/contracts";
import type { GoogleApiClient } from "./client.js";

export interface GmailWatchAccount {
  ownerId: Id<"user">;
  accountId: Id<"connected-account">;
}

export interface GmailWatchResult {
  status: "configured" | "not_configured";
  historyId?: string;
  expiration?: string;
}

export interface GmailWatchRenewalResult {
  status: "configured" | "not_configured";
  renewed: number;
  failed: number;
}

/**
 * Manages Gmail Pub/Sub watch lifecycle. Gmail `users.watch` expires after
 * ~7 days and must be renewed periodically. The manager returns
 * `not_configured` when the Pub/Sub topic is absent rather than throwing,
 * per the project's missing-credentials contract.
 */
export function createGmailWatchManager(input: {
  google: GoogleApiClient;
  topicName?: string;
}) {
  async function watch(params: GmailWatchAccount): Promise<GmailWatchResult> {
    if (input.topicName === undefined) return { status: "not_configured" };
    const result = await input.google.gmailWatch({
      ownerId: params.ownerId,
      accountId: params.accountId,
      topicName: input.topicName,
      labelIds: ["INBOX"],
    });
    return {
      status: "configured",
      historyId: result.historyId,
      ...(result.expiration === undefined
        ? {}
        : { expiration: result.expiration }),
    };
  }

  return {
    startWatch: watch,
    // Gmail watch is idempotent — renewal is the same API call.
    renewWatch: watch,

    /**
     * Renews watches for all accounts returned by `listAccounts`.
     * Intended to be called from the worker loop's periodic tick.
     */
    async renewAll(
      listAccounts: () => Promise<GmailWatchAccount[]>,
    ): Promise<GmailWatchRenewalResult> {
      if (input.topicName === undefined)
        return { status: "not_configured", renewed: 0, failed: 0 };
      const accounts = await listAccounts();
      let renewed = 0;
      let failed = 0;
      for (const account of accounts) {
        try {
          const result = await watch(account);
          if (result.status === "configured") renewed += 1;
        } catch {
          // Per-account failures should not block the renewal sweep.
          failed += 1;
        }
      }
      return { status: "configured", renewed, failed };
    },
  };
}

export type GmailWatchManager = ReturnType<typeof createGmailWatchManager>;
