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
});
