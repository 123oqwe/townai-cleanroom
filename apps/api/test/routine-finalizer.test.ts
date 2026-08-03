import { describe, expect, it, vi } from "vitest";

import { asId } from "@town/contracts";
import type {
  RoutineRepository,
  RoutineResultRepository,
} from "@town/routines";
import { finalizeRoutineRun } from "../src/routine-finalizer.js";

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
});
