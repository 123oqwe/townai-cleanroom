import type { Sql } from "postgres";

import { asId, type Id } from "@town/contracts";
import type {
  RoutineRepository,
  RoutineResultRepository,
} from "@town/routines";
import type { ChannelRepository } from "@town/channels";

export interface RoutineRunFinalizerDependencies {
  sql: Sql;
  routines: RoutineRepository;
  results: RoutineResultRepository;
  channels?: ChannelRepository;
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
  channels?: ChannelRepository;
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
  const result =
    input.state === "completed"
      ? await input.results.complete({
          ...base,
          output: { runtimeRunId: input.runtimeRunId },
        })
      : await input.results.fail({
          ...base,
          errorCode: input.errorCode ?? "RUNTIME_FAILURE",
          errorMessage: "The routine runtime failed before producing a result.",
        });

  const listTriggers = input.routines.listTriggers;
  if (input.channels === undefined || typeof listTriggers !== "function")
    return;
  try {
    const trigger = (
      await listTriggers(input.ownerId, reconciled.routineScheduleId)
    ).find((candidate) => {
      if (!candidate.enabled || candidate.kind !== "outgoing_email")
        return false;
      const channelId =
        candidate.config["notificationChannelId"] ??
        candidate.config["channelId"];
      return typeof channelId === "string" && channelId.length > 0;
    });
    if (trigger === undefined) return;
    const channelId = asId<"notification-channel">(
      String(
        trigger.config["notificationChannelId"] ?? trigger.config["channelId"],
      ),
    );
    const delivery = await input.channels.enqueue({
      ownerId: input.ownerId,
      channelId,
      eventType: "routine.result",
      idempotencyKey: `routine-result:${result.id}`,
      payload: {
        resultId: result.id,
        runId: input.runtimeRunId,
        subject: routine.name,
        status: result.status,
        ...(input.state === "completed"
          ? { output: { runtimeRunId: input.runtimeRunId } }
          : { errorCode: input.errorCode ?? "RUNTIME_FAILURE" }),
      },
    });
    await input.results.linkNotification(input.ownerId, result.id, delivery.id);
  } catch {
    // Notification delivery is an independent outbox concern. Never turn a
    // durable runtime result into a fabricated failure because its channel is
    // disabled or temporarily unavailable.
  }
}
