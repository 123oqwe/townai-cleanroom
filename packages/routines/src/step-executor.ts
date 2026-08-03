import { z } from "zod";

import type { Id } from "@town/contracts";

import type {
  RoutineStepRepository,
  RoutineStepResult,
} from "./step-repository.js";

const executeInputSchema = z
  .object({
    ownerId: z.uuidv7(),
    runId: z.uuidv7(),
    stepKey: z.string().trim().min(1).max(200),
  })
  .strict();

export interface RoutineStepExecutionResult {
  output: unknown;
  cached: boolean;
  step: RoutineStepResult;
}

export class RoutineStepExecutionError extends Error {
  constructor(
    readonly code: "ROUTINE_STEP_IN_PROGRESS",
    message: string,
  ) {
    super(message);
    this.name = "RoutineStepExecutionError";
  }
}

/**
 * Executes one durable Routine step exactly once for a run/key pair. A
 * completed result is returned without invoking the callback; a failed result
 * is reclaimed by the repository and may be retried. Concurrent running work
 * fails explicitly instead of duplicating an external side effect.
 */
export function createRoutineStepExecutor(repository: RoutineStepRepository) {
  return {
    async execute(input: {
      ownerId: Id<"user">;
      runId: string;
      stepKey: string;
      run: () => Promise<unknown>;
    }): Promise<RoutineStepExecutionResult> {
      const value = executeInputSchema.parse({
        ownerId: input.ownerId,
        runId: input.runId,
        stepKey: input.stepKey,
      });
      const begun = await repository.begin(value);
      if (!begun.acquired) {
        if (begun.result.status === "completed") {
          return {
            output: begun.result.output,
            cached: true,
            step: begun.result,
          };
        }
        throw new RoutineStepExecutionError(
          "ROUTINE_STEP_IN_PROGRESS",
          "The Routine step is already running for this run.",
        );
      }

      try {
        const output = await input.run();
        const step = await repository.complete({ ...value, output });
        return { output, cached: false, step };
      } catch (error) {
        const errorCode =
          error instanceof Error && error.name.trim() !== ""
            ? error.name.slice(0, 100)
            : "ROUTINE_STEP_FAILED";
        const errorMessage =
          error instanceof Error && error.message.trim() !== ""
            ? error.message.slice(0, 4_000)
            : "Routine step execution failed.";
        await repository
          .fail({ ...value, errorCode, errorMessage })
          .catch(() => undefined);
        throw error;
      }
    },
  };
}

export type RoutineStepExecutor = ReturnType<typeof createRoutineStepExecutor>;
