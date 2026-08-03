import type { Id } from "@town/contracts";
import type { GoogleApiClient } from "@town/google";
import type { RoutineRepository } from "@town/routines";

export interface GoogleCalendarPollingTarget {
  ownerId: Id<"user">;
  routineScheduleId: Id<"routine-schedule">;
  routineTriggerId: Id<"routine-trigger">;
  accountId: Id<"connected-account">;
  calendarId?: string;
  lookbackMinutes?: number;
  lookaheadMinutes?: number;
  maxResults?: number;
}

export interface GoogleCalendarPollResult {
  skipped: boolean;
  targets: number;
  events: number;
  queued: number;
  failed: number;
}

export function createGoogleCalendarPoller(input: {
  listTargets: () => Promise<GoogleCalendarPollingTarget[]>;
  google: GoogleApiClient;
  routines: RoutineRepository;
  intervalMs?: number;
}) {
  const intervalMs = Math.max(0, input.intervalMs ?? 60_000);
  let lastPollAt: number | null = null;

  return {
    async poll(now = new Date()): Promise<GoogleCalendarPollResult> {
      const timestamp = now.getTime();
      if (lastPollAt !== null && timestamp - lastPollAt < intervalMs)
        return { skipped: true, targets: 0, events: 0, queued: 0, failed: 0 };
      lastPollAt = timestamp;
      const targets = await input.listTargets();
      let events = 0;
      let queued = 0;
      let failed = 0;
      for (const target of targets) {
        try {
          const lookback = target.lookbackMinutes ?? 5;
          const lookahead = target.lookaheadMinutes ?? 24 * 60;
          const timeMin = new Date(
            timestamp - Math.max(0, lookback) * 60_000,
          ).toISOString();
          const timeMax = new Date(
            timestamp + Math.max(0, lookahead) * 60_000,
          ).toISOString();
          const found = await input.google.calendarListEvents({
            ownerId: target.ownerId,
            accountId: target.accountId,
            calendarId: target.calendarId ?? "primary",
            timeMin,
            timeMax,
            maxResults: target.maxResults ?? 100,
          });
          events += found.items.length;
          for (const event of found.items) {
            const eventId = event["id"];
            if (typeof eventId !== "string" || eventId.length === 0) continue;
            const updated = event["updated"];
            const version = typeof updated === "string" ? updated : "current";
            await input.routines.queueTrigger(
              target.ownerId,
              target.routineScheduleId,
              "calendar",
              {
                provider: "google_calendar",
                accountId: target.accountId,
                routineTriggerId: target.routineTriggerId,
                eventId,
                event,
              },
              `gcal:${target.accountId}:${target.routineTriggerId}:${eventId}:${version}`,
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
        events,
        queued,
        failed,
      };
    },
  };
}

export type GoogleCalendarPoller = ReturnType<
  typeof createGoogleCalendarPoller
>;
