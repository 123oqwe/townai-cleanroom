import type { Sql } from "postgres";

import { asId } from "@town/contracts";
import type { AgentRepository, ThreadRepository } from "@town/agents";
import type { SessionRepository } from "@town/runtime";
import type { RoutineRepository } from "@town/routines";

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
      select distinct owner_id from routine_schedules
      where enabled=true and next_run_at <= ${now}
      order by owner_id limit 100
    `;
    let claimed = 0;
    let queued = 0;
    let failed = 0;
    for (const owner of owners) {
      const ownerId = asId<"user">(owner.owner_id);
      const due = await dependencies.routines.claimDue(ownerId, now);
      claimed += due.length;
      for (const routine of due) {
        try {
          const agent = await dependencies.agents.getRoutine(
            ownerId,
            routine.agentId,
          );
          const thread = await dependencies.threads.createTask({
            ownerId,
            agentId: agent.id,
            title: routine.name,
            approvalMode: agent.activeVersion.snapshot.defaultApprovalMode,
          });
          await dependencies.sessions.submitMessage({
            ownerId,
            threadId: thread.id,
            idempotencyKey: `schedule:${routine.id}:${routine.claimId}`,
            text: `Run scheduled routine: ${routine.name}`,
            mentions: [],
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
    }
    return { ownersScanned: owners.length, claimed, queued, failed };
  };
}

export type RoutineScheduler = ReturnType<typeof createRoutineScheduler>;
