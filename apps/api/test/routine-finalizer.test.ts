import { describe, expect, it, vi } from "vitest";

import { asId } from "@town/contracts";
import type {
  RoutineRepository,
  RoutineResultRepository,
} from "@town/routines";
import type { ChannelRepository } from "@town/channels";
import { finalizeRoutineRun } from "../src/lib/routine-finalizer.js";

describe("routine run finalizer", () => {
  it("reconciles the integration run and records a completed result", async () => {
    const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");
    const runtimeRunId = asId<"session-run">(
      "01900000-0000-7000-8000-000000000002",
    );
    const sessionId = asId<"runtime-session">(
      "01900000-0000-7000-8000-000000000003",
    );
    const routineScheduleId = asId<"routine-schedule">(
      "01900000-0000-7000-8000-000000000004",
    );
    const routines = {
      reconcileRuntimeRun: vi.fn().mockResolvedValue({
        runtimeRunId,
        routineScheduleId,
      }),
      get: vi
        .fn()
        .mockResolvedValue({ id: routineScheduleId, name: "Briefing" }),
    } as unknown as RoutineRepository;
    const results = {
      complete: vi.fn().mockResolvedValue({ id: "result-1" }),
      fail: vi.fn(),
    } as unknown as RoutineResultRepository;
    const sql = vi.fn().mockResolvedValue([{ session_id: sessionId }]);

    await finalizeRoutineRun({
      sql: sql as never,
      routines,
      results,
      ownerId,
      runtimeRunId,
      state: "completed",
    });

    expect(results.complete).toHaveBeenCalledWith({
      ownerId,
      sessionId,
      runId: runtimeRunId,
      routineScheduleId,
      subject: "Briefing",
      output: { runtimeRunId },
    });
    expect(results.fail).not.toHaveBeenCalled();
  });

  it("associates an explicitly configured notification delivery with the result", async () => {
    const ownerId = asId<"user">("01900000-0000-7000-8000-000000000011");
    const runtimeRunId = asId<"session-run">(
      "01900000-0000-7000-8000-000000000012",
    );
    const sessionId = asId<"runtime-session">(
      "01900000-0000-7000-8000-000000000013",
    );
    const routineScheduleId = asId<"routine-schedule">(
      "01900000-0000-7000-8000-000000000014",
    );
    const channelId = asId<"notification-channel">(
      "01900000-0000-7000-8000-000000000015",
    );
    const notificationId = asId<"notification-delivery">(
      "01900000-0000-7000-8000-000000000016",
    );
    const resultId = asId<"routine-result">(
      "01900000-0000-7000-8000-000000000017",
    );
    const routines = {
      reconcileRuntimeRun: vi.fn().mockResolvedValue({
        runtimeRunId,
        routineScheduleId,
      }),
      get: vi
        .fn()
        .mockResolvedValue({ id: routineScheduleId, name: "Briefing" }),
      listTriggers: vi.fn().mockResolvedValue([
        {
          enabled: true,
          kind: "outgoing_email",
          config: { notificationChannelId: channelId },
        },
      ]),
    } as unknown as RoutineRepository;
    const result = { id: resultId, status: "completed" };
    const results = {
      complete: vi.fn().mockResolvedValue(result),
      linkNotification: vi
        .fn()
        .mockResolvedValue({ ...result, notificationId }),
      fail: vi.fn(),
    } as unknown as RoutineResultRepository;
    const channels = {
      enqueue: vi.fn().mockResolvedValue({ id: notificationId }),
    } as unknown as ChannelRepository;
    const sql = vi.fn().mockResolvedValue([{ session_id: sessionId }]);

    await finalizeRoutineRun({
      sql: sql as never,
      routines,
      results,
      channels,
      ownerId,
      runtimeRunId,
      state: "completed",
    });

    expect(channels.enqueue).toHaveBeenCalledWith({
      ownerId,
      channelId,
      eventType: "routine.result",
      idempotencyKey: `routine-result:${resultId}`,
      payload: expect.objectContaining({ resultId, runId: runtimeRunId }),
    });
    expect(results.linkNotification).toHaveBeenCalledWith(
      ownerId,
      resultId,
      notificationId,
    );
  });
});
