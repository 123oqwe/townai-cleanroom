import { describe, expect, it, vi } from "vitest";

import { asId } from "@town/contracts";
import type { AgentRepository, ThreadRepository } from "@town/agents";
import type { SessionRepository } from "@town/runtime";
import type { RoutineRepository } from "@town/routines";
import { createRoutineScheduler } from "../src/routine-scheduler.js";

describe("routine scheduler", () => {
  it("claims due schedules and submits durable session runs", async () => {
    const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");
    const schedule = {
      id: asId<"routine-schedule">("01900000-0000-7000-8000-000000000002"),
      ownerId,
      agentId: asId<"agent">("01900000-0000-7000-8000-000000000003"),
      claimId: asId<"integration-sync-run">(
        "01900000-0000-7000-8000-000000000004",
      ),
      name: "Briefing",
    };
    const sql = vi.fn().mockResolvedValue([{ owner_id: ownerId }]);
    const routines = {
      claimDue: vi.fn().mockResolvedValue([schedule]),
      attachRuntimeRun: vi.fn(),
      startRun: vi.fn(),
      failRun: vi.fn(),
    } as unknown as RoutineRepository;
    const agents = {
      getRoutine: vi.fn().mockResolvedValue({
        id: schedule.agentId,
        activeVersion: { snapshot: { defaultApprovalMode: "autonomous" } },
      }),
    } as unknown as AgentRepository;
    const threads = {
      createTask: vi
        .fn()
        .mockResolvedValue({ id: "01900000-0000-7000-8000-000000000005" }),
    } as unknown as ThreadRepository;
    const submitMessage = vi.fn().mockResolvedValue({
      run: { id: asId<"session-run">("01900000-0000-7000-8000-000000000006") },
    });
    const sessions = { submitMessage } as unknown as SessionRepository;
    const result = await createRoutineScheduler({
      sql: sql as never,
      routines,
      agents,
      threads,
      sessions,
    })(new Date("2026-08-03T00:00:00Z"));
    expect(result).toMatchObject({
      ownersScanned: 1,
      claimed: 1,
      queued: 1,
      failed: 0,
    });
    expect(submitMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `schedule:${schedule.id}:${schedule.claimId}`,
      }),
    );
  });

  it("claims queued webhook runs and passes untrusted trigger data into the session", async () => {
    const ownerId = asId<"user">("01900000-0000-7000-8000-000000000011");
    const routineId = asId<"routine-schedule">(
      "01900000-0000-7000-8000-000000000012",
    );
    const claimToken = "01900000-0000-7000-8000-000000000013";
    const run = {
      id: asId<"integration-sync-run">("01900000-0000-7000-8000-000000000014"),
      ownerId,
      routineScheduleId: routineId,
      triggerType: "webhook",
      triggerData: { event: "ping" },
      claimToken,
    };
    const routine = {
      id: routineId,
      ownerId,
      agentId: asId<"agent">("01900000-0000-7000-8000-000000000015"),
      name: "Webhook briefing",
    };
    const sql = vi.fn().mockResolvedValue([{ owner_id: ownerId }]);
    const routines = {
      claimDue: vi.fn().mockResolvedValue([]),
      claimQueued: vi.fn().mockResolvedValue([run]),
      get: vi.fn().mockResolvedValue(routine),
      attachRuntimeRun: vi.fn(),
      failQueuedRun: vi.fn(),
    } as unknown as RoutineRepository;
    const agents = {
      getRoutine: vi.fn().mockResolvedValue({
        id: routine.agentId,
        activeVersion: { snapshot: { defaultApprovalMode: "autonomous" } },
      }),
    } as unknown as AgentRepository;
    const threads = {
      createTask: vi
        .fn()
        .mockResolvedValue({ id: "01900000-0000-7000-8000-000000000016" }),
    } as unknown as ThreadRepository;
    const submitMessage = vi.fn().mockResolvedValue({
      run: { id: asId<"session-run">("01900000-0000-7000-8000-000000000017") },
    });

    await createRoutineScheduler({
      sql: sql as never,
      routines,
      agents,
      threads,
      sessions: { submitMessage } as unknown as SessionRepository,
    })(new Date("2026-08-03T00:00:00Z"));

    expect(submitMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('"event":"ping"'),
      }),
    );
    expect(routines.attachRuntimeRun).toHaveBeenCalledWith(
      ownerId,
      run.id,
      expect.anything(),
      claimToken,
    );
  });

  it("marks due schedule claims as failed when enqueueing the trigger errors", async () => {
    const ownerId = asId<"user">("01900000-0000-7000-8000-000000000021");
    const routine = {
      id: asId<"routine-schedule">("01900000-0000-7000-8000-000000000022"),
      ownerId,
      agentId: asId<"agent">("01900000-0000-7000-8000-000000000023"),
      claimId: asId<"integration-sync-run">(
        "01900000-0000-7000-8000-000000000024",
      ),
      name: "Failing schedule",
    };
    const sql = vi.fn().mockResolvedValue([{ owner_id: ownerId }]);
    const routines = {
      claimDue: vi.fn().mockResolvedValue([routine]),
      attachRuntimeRun: vi.fn(),
      startRun: vi.fn(),
      failRun: vi.fn(),
      failQueuedRun: vi.fn(),
    } as unknown as RoutineRepository;
    const agents = {
      getRoutine: vi.fn().mockResolvedValue({
        id: routine.agentId,
        activeVersion: { snapshot: { defaultApprovalMode: "autonomous" } },
      }),
    } as unknown as AgentRepository;
    const threads = {
      createTask: vi.fn().mockRejectedValue(new Error("queue unavailable")),
    } as unknown as ThreadRepository;
    const submitMessage = vi.fn().mockResolvedValue({
      run: { id: asId<"session-run">("01900000-0000-7000-8000-000000000025") },
    });

    const result = await createRoutineScheduler({
      sql: sql as never,
      routines,
      agents,
      threads,
      sessions: { submitMessage } as unknown as SessionRepository,
    })(new Date("2026-08-03T00:00:00Z"));

    expect(result).toMatchObject({
      ownersScanned: 1,
      claimed: 1,
      queued: 0,
      failed: 1,
    });
    expect((routines.startRun as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      ownerId,
      routine.claimId,
    );
    expect((routines.failRun as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      ownerId,
      routine.claimId,
      "SCHEDULE_TRIGGER_FAILED",
    );
    expect(submitMessage).not.toHaveBeenCalled();
  });

  it("marks queued trigger claims as failed when routine resolution fails", async () => {
    const ownerId = asId<"user">("01900000-0000-7000-8000-000000000026");
    const claimToken = "01900000-0000-7000-8000-000000000027";
    const run = {
      id: asId<"integration-sync-run">("01900000-0000-7000-8000-000000000028"),
      ownerId,
      routineScheduleId: null,
      triggerType: "webhook",
      triggerData: { event: "ping" },
      claimToken,
    };
    const sql = vi.fn().mockResolvedValue([{ owner_id: ownerId }]);
    const routines = {
      claimDue: vi.fn().mockResolvedValue([]),
      claimQueued: vi.fn().mockResolvedValue([run]),
      failQueuedRun: vi.fn(),
      startRun: vi.fn(),
      failRun: vi.fn(),
      attachRuntimeRun: vi.fn(),
      get: vi.fn(),
    } as unknown as RoutineRepository;
    const agents = {
      getRoutine: vi.fn().mockResolvedValue({
        id: asId<"agent">("01900000-0000-7000-8000-000000000029"),
        activeVersion: { snapshot: { defaultApprovalMode: "autonomous" } },
      }),
    } as unknown as AgentRepository;
    const submitMessage = vi.fn().mockResolvedValue({
      run: { id: asId<"session-run">("01900000-0000-7000-8000-000000000030") },
    });

    const result = await createRoutineScheduler({
      sql: sql as never,
      routines,
      agents,
      threads: {
        createTask: vi
          .fn()
          .mockResolvedValue({ id: asId<"thread">("01900000-0000-7000-8000-000000000031") }),
      } as unknown as ThreadRepository,
      sessions: { submitMessage } as unknown as SessionRepository,
    })(new Date("2026-08-03T00:00:00Z"));

    expect(result).toMatchObject({
      ownersScanned: 1,
      claimed: 1,
      queued: 0,
      failed: 1,
    });
    expect((routines.failQueuedRun as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      ownerId,
      run.id,
      run.claimToken,
      "TRIGGER_ENQUEUE_FAILED",
    );
  });
});
