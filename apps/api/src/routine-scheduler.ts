import type { Sql } from "postgres";

import { asId, type Id } from "@town/contracts";
import type { AgentRepository, ThreadRepository } from "@town/agents";
import type { SessionRepository } from "@town/runtime";
import type { RoutineRepository, RoutineSchedule } from "@town/routines";

export interface RoutineSchedulerDependencies {
  sql: Sql;
  routines: RoutineRepository;
  agents: AgentRepository;
  threads: ThreadRepository;
  sessions: SessionRepository;
}

export interface RoutineSchedulerResult {
  ownersScanned: number;
  claimed: number;
  queued: number;
  failed: number;
}

/** Claims due schedules once, then hands each claim to the durable Session queue. */
export function createRoutineScheduler(
  dependencies: RoutineSchedulerDependencies,
) {
  return async function scheduleDue(
    now = new Date(),
  ): Promise<RoutineSchedulerResult> {
    const owners = await dependencies.sql<{ owner_id: string }[]>`
      select owner_id from routine_schedules
      where enabled=true and next_run_at <= ${now}
      union
      select owner_id from integration_sync_runs
      where status='queued' and routine_schedule_id is not null
        and (claim_expires_at is null or claim_expires_at <= ${now})
      order by owner_id limit 100
    `;
    let claimed = 0;
    let queued = 0;
    let failed = 0;
    const enqueue = async (input: {
      ownerId: Id<"user">;
      routine: RoutineSchedule;
      runtimeRunId: Id<"integration-sync-run">;
      triggerType: string;
      triggerData: Record<string, unknown>;
      idempotencyKey?: string;
      claimToken?: string;
    }) => {
      const agent = await dependencies.agents.getRoutine(
        input.ownerId,
        input.routine.agentId,
      );
      const thread = await dependencies.threads.createTask({
        ownerId: input.ownerId,
        agentId: agent.id,
        title: input.routine.name,
        approvalMode: agent.activeVersion.snapshot.defaultApprovalMode,
      });
      const triggerText =
        input.triggerType === "schedule"
          ? `Run scheduled routine: ${input.routine.name}`
          : `Run ${input.triggerType} routine: ${input.routine.name}\nTrigger data (untrusted): ${JSON.stringify(input.triggerData)}`;
      const submission = await dependencies.sessions.submitMessage({
        ownerId: input.ownerId,
        threadId: thread.id,
        idempotencyKey:
          input.idempotencyKey ?? `${input.triggerType}:${input.runtimeRunId}`,
        text: triggerText,
        mentions: [],
      });
      await dependencies.routines.attachRuntimeRun(
        input.ownerId,
        input.runtimeRunId,
        submission.run.id,
        input.claimToken,
      );
    };
    for (const owner of owners) {
      const ownerId = asId<"user">(owner.owner_id);
      const due = await dependencies.routines.claimDue(ownerId, now);
      claimed += due.length;
      for (const routine of due) {
        try {
          await enqueue({
            ownerId,
            routine,
            runtimeRunId: routine.claimId,
            triggerType: "schedule",
            triggerData: { scheduleId: routine.id },
            idempotencyKey: `schedule:${routine.id}:${routine.claimId}`,
          });
          queued += 1;
        } catch {
          try {
            await dependencies.routines.startRun(ownerId, routine.claimId);
            await dependencies.routines.failRun(
              ownerId,
              routine.claimId,
              "SCHEDULE_TRIGGER_FAILED",
            );
          } catch {
            // The claim may not have an active connected account; preserve the scheduler result without masking the original failure.
          }
          failed += 1;
        }
      }
      const claimQueued = dependencies.routines.claimQueued;
      if (typeof claimQueued !== "function") continue;
      const queuedRuns = await claimQueued(
        ownerId,
        `routine-scheduler:${process.pid}`,
      );
      claimed += queuedRuns.length;
      for (const run of queuedRuns) {
        try {
          if (run.routineScheduleId === null)
            throw new Error("ROUTINE_SCHEDULE_MISSING");
          const routine = await dependencies.routines.get(
            ownerId,
            run.routineScheduleId,
          );
          await enqueue({
            ownerId,
            routine,
            runtimeRunId: run.id,
            triggerType: run.triggerType,
            triggerData: run.triggerData,
            claimToken: run.claimToken,
          });
          queued += 1;
        } catch {
          try {
            await dependencies.routines.failQueuedRun?.(
              ownerId,
              run.id,
              run.claimToken,
              "TRIGGER_ENQUEUE_FAILED",
            );
          } catch {
            // Preserve the scheduler result without masking the original failure.
          }
          failed += 1;
        }
      }
    }
    return { ownersScanned: owners.length, claimed, queued, failed };
  };
}

export type RoutineScheduler = ReturnType<typeof createRoutineScheduler>;
