import { describe, expect, it, vi } from "vitest";

import { asId } from "@town/contracts";
import type { GoogleApiClient } from "@town/google";
import type { RoutineRepository } from "@town/routines";
import { createGoogleCalendarPoller } from "../src/google-calendar-poller.js";

const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");
const routineId = asId<"routine-schedule">(
  "01900000-0000-7000-8000-000000000002",
);
const triggerId = asId<"routine-trigger">(
  "01900000-0000-7000-8000-000000000003",
);
const accountId = asId<"connected-account">(
  "01900000-0000-7000-8000-000000000004",
);

describe("Google Calendar poller", () => {
  it("lists real events and queues changed-event ids idempotently", async () => {
    const google = {
      calendarListEvents: vi.fn().mockResolvedValue({
        items: [
          {
            id: "event-1",
            status: "confirmed",
            summary: "Focus",
            updated: "2026-08-03T00:01:00Z",
          },
        ],
      }),
    } as unknown as GoogleApiClient;
    const routines = {
      queueTrigger: vi.fn().mockResolvedValue({ id: "run-1" }),
    } as unknown as RoutineRepository;
    const poller = createGoogleCalendarPoller({
      listTargets: async () => [
        {
          ownerId,
          routineScheduleId: routineId,
          routineTriggerId: triggerId,
          accountId,
          calendarId: "primary",
          lookbackMinutes: 5,
          lookaheadMinutes: 60,
          maxResults: 25,
        },
      ],
      google,
      routines,
      intervalMs: 0,
    });
    await expect(
      poller.poll(new Date("2026-08-03T00:00:00Z")),
    ).resolves.toEqual({
      skipped: false,
      targets: 1,
      events: 1,
      queued: 1,
      failed: 0,
    });
    expect(google.calendarListEvents).toHaveBeenCalledWith({
      ownerId,
      accountId,
      calendarId: "primary",
      timeMin: "2026-08-02T23:55:00.000Z",
      timeMax: "2026-08-03T01:00:00.000Z",
      maxResults: 25,
    });
    expect(routines.queueTrigger).toHaveBeenCalledWith(
      ownerId,
      routineId,
      "calendar",
      expect.objectContaining({
        eventId: "event-1",
        routineTriggerId: triggerId,
      }),
      `gcal:${accountId}:${triggerId}:event-1:2026-08-03T00:01:00Z`,
      accountId,
    );
  });
});
