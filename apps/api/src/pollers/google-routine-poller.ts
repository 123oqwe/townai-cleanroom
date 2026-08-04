import type { Id } from "@town/contracts";
import type { GoogleApiClient } from "@town/google";
import type { RoutineRepository } from "@town/routines";

export interface GoogleRoutinePollingTarget {
  ownerId: Id<"user">;
  routineScheduleId: Id<"routine-schedule">;
  accountId: Id<"connected-account">;
  query?: string;
  maxResults?: number;
  triggerType?: "incoming_email" | "email_to_assistant";
  assistantAddress?: string;
}

export interface GoogleRoutinePollResult {
  skipped: boolean;
  targets: number;
  messages: number;
  queued: number;
  failed: number;
}

export function createGoogleRoutinePoller(input: {
  listTargets: () => Promise<GoogleRoutinePollingTarget[]>;
  google: GoogleApiClient;
  routines: RoutineRepository;
  intervalMs?: number;
}) {
  const intervalMs = Math.max(0, input.intervalMs ?? 60_000);
  let lastPollAt: number | null = null;

  return {
    async poll(now = new Date()): Promise<GoogleRoutinePollResult> {
      const timestamp = now.getTime();
      if (lastPollAt !== null && timestamp - lastPollAt < intervalMs)
        return { skipped: true, targets: 0, messages: 0, queued: 0, failed: 0 };
      lastPollAt = timestamp;
      const targets = await input.listTargets();
      let messages = 0;
      let queued = 0;
      let failed = 0;
      for (const target of targets) {
        try {
          if (
            target.triggerType === "email_to_assistant" &&
            !target.assistantAddress
          ) {
            failed += 1;
            continue;
          }
          const query =
            target.triggerType === "email_to_assistant"
              ? `${target.query ?? "in:anywhere newer_than:1d"} to:${target.assistantAddress}`
              : (target.query ?? "in:anywhere newer_than:1d");
          const found = await input.google.gmailSearch({
            ownerId: target.ownerId,
            accountId: target.accountId,
            query,
            maxResults: target.maxResults ?? 10,
          });
          messages += found.messages.length;
          for (const message of found.messages) {
            const detail = await input.google.gmailGetMessage({
              ownerId: target.ownerId,
              accountId: target.accountId,
              messageId: message.id,
            });
            const labels = detail["labelIds"] ?? message["labelIds"] ?? [];
            const triggerType = target.triggerType ?? "incoming_email";
            await input.routines.queueTrigger(
              target.ownerId,
              target.routineScheduleId,
              // A configured email-to-assistant trigger must remain distinct
              // so downstream policy can apply the assistant-address boundary.
              triggerType,
              {
                provider: "google_gmail",
                accountId: target.accountId,
                messageId: message.id,
                threadId: message.threadId,
                labels,
                payload: detail.payload ?? null,
              },
              `gmail:${target.accountId}:${message.id}`,
              target.accountId,
            );
            queued += 1;
          }
        } catch {
          failed += 1;
        }
      }
      return {
        skipped: false,
        targets: targets.length,
        messages,
        queued,
        failed,
      };
    },
  };
}

export type GoogleRoutinePoller = ReturnType<typeof createGoogleRoutinePoller>;
