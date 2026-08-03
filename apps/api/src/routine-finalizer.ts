import type { Sql } from "postgres";

import { asId, type Id } from "@town/contracts";
import type {
  RoutineRepository,
  RoutineResultRepository,
} from "@town/routines";

export interface RoutineRunFinalizerDependencies {
  sql: Sql;
  routines: RoutineRepository;
  results: RoutineResultRepository;
}

/**
 * Links a completed runtime run back to its schedule and records the durable
 * user-visible result. A missing link is intentionally a no-op: interactive
 * sessions are not routine runs and must not create fabricated RoutineResult
 * rows.
 */
export async function finalizeRoutineRun(input: {
  sql: Sql;
  routines: RoutineRepository;
  results: RoutineResultRepository;
  ownerId: Id<"user">;
  runtimeRunId: Id<"session-run">;
  state: "completed" | "failed";
  errorCode?: string;
}): Promise<void> {
  const reconciled = await input.routines.reconcileRuntimeRun({
    ownerId: input.ownerId,
    runtimeRunId: input.runtimeRunId,
    status: input.state,
    ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
  });
  if (reconciled === null || reconciled.routineScheduleId === null) return;

  const [runtime] = await input.sql<{ session_id: string }[]>`
    select session_id from session_runs
    where owner_id=${input.ownerId} and id=${input.runtimeRunId}
  `;
  if (runtime === undefined) return;

  const routine = await input.routines.get(
    input.ownerId,
    reconciled.routineScheduleId,
  );
  const base = {
    ownerId: input.ownerId,
    sessionId: asId<"runtime-session">(runtime.session_id),
    runId: input.runtimeRunId,
    routineScheduleId: reconciled.routineScheduleId,
    subject: routine.name,
  } as const;
  if (input.state === "completed") {
    await input.results.complete({
      ...base,
      output: { runtimeRunId: input.runtimeRunId },
    });
  } else {
    await input.results.fail({
      ...base,
      errorCode: input.errorCode ?? "RUNTIME_FAILURE",
      errorMessage: "The routine runtime failed before producing a result.",
    });
  }
}
