import { describe, expect, it, vi } from "vitest";

import { asId } from "@town/contracts";
import type { GoogleApiClient } from "@town/google";
import type { RoutineRepository } from "@town/routines";
import { createGoogleRoutinePoller } from "../src/google-routine-poller.js";

const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");
const routineId = asId<"routine-schedule">(
  "01900000-0000-7000-8000-000000000002",
);
const accountId = asId<"connected-account">(
  "01900000-0000-7000-8000-000000000003",
);

describe("Google routine poller", () => {
  it("fetches configured Gmail triggers and queues each message idempotently", async () => {
    const google = {
      gmailSearch: vi.fn().mockResolvedValue({
        messages: [{ id: "message-1", threadId: "thread-1" }],
      }),
      gmailGetMessage: vi.fn().mockResolvedValue({
        id: "message-1",
        threadId: "thread-1",
        labelIds: ["INBOX"],
        payload: { headers: [] },
      }),
    } as unknown as GoogleApiClient;
    const routines = {
      queueTrigger: vi.fn().mockResolvedValue({ id: "run-1" }),
    } as unknown as RoutineRepository;
    const poller = createGoogleRoutinePoller({
      listTargets: async () => [
        {
          ownerId,
          routineScheduleId: routineId,
          accountId,
          query: "from:alerts@example.com",
          maxResults: 20,
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
      messages: 1,
      queued: 1,
      failed: 0,
    });
    expect(google.gmailSearch).toHaveBeenCalledWith({
      ownerId,
      accountId,
      query: "from:alerts@example.com",
      maxResults: 20,
    });
    expect(routines.queueTrigger).toHaveBeenCalledWith(
      ownerId,
      routineId,
      "incoming_email",
      expect.objectContaining({ messageId: "message-1", accountId }),
      `gmail:${accountId}:message-1`,
      accountId,
    );
  });

  it("does not hammer Gmail between poll intervals and isolates target failures", async () => {
    const google = {
      gmailSearch: vi.fn().mockRejectedValue(new Error("provider down")),
      gmailGetMessage: vi.fn(),
    } as unknown as GoogleApiClient;
    const poller = createGoogleRoutinePoller({
      listTargets: async () => [
        { ownerId, routineScheduleId: routineId, accountId },
      ],
      google,
      routines: {} as RoutineRepository,
      intervalMs: 60_000,
    });
    await expect(
      poller.poll(new Date("2026-08-03T00:00:00Z")),
    ).resolves.toMatchObject({
      skipped: false,
      failed: 1,
    });
    await expect(
      poller.poll(new Date("2026-08-03T00:00:10Z")),
    ).resolves.toEqual({
      skipped: true,
      targets: 0,
      messages: 0,
      queued: 0,
      failed: 0,
    });
    expect(google.gmailSearch).toHaveBeenCalledTimes(1);
  });

  it("preserves the email-to-assistant trigger kind", async () => {
    const google = {
      gmailSearch: vi
        .fn()
        .mockResolvedValue({ messages: [{ id: "m-assistant" }] }),
      gmailGetMessage: vi
        .fn()
        .mockResolvedValue({ payload: { body: "hello" } }),
    } as unknown as GoogleApiClient;
    const queueTrigger = vi.fn().mockResolvedValue({ id: "run-assistant" });
    const poller = createGoogleRoutinePoller({
      listTargets: async () => [
        {
          ownerId,
          routineScheduleId: routineId,
          accountId,
          triggerType: "email_to_assistant",
          assistantAddress: "assistant@example.invalid",
        },
      ],
      google,
      routines: { queueTrigger } as unknown as RoutineRepository,
      intervalMs: 0,
    });
    await poller.poll(new Date("2026-08-04T00:00:00Z"));
    expect(google.gmailSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "in:anywhere newer_than:1d to:assistant@example.invalid",
      }),
    );
    expect(queueTrigger.mock.calls[0]?.[2]).toBe("email_to_assistant");
  });
});
