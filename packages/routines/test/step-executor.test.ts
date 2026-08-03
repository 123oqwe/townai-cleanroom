import { describe, expect, it, vi } from "vitest";

import {
  createRoutineStepExecutor,
  RoutineStepExecutionError,
} from "../src/step-executor.js";

const ownerId = "01900000-0000-7000-8000-000000000001" as never;
const runId = "01900000-0000-7000-8000-000000000002";

function step(
  status: "running" | "completed" | "failed",
  output: unknown = null,
) {
  return {
    ownerId,
    runId,
    stepKey: "collect",
    status,
    output,
    errorCode: null,
    errorMessage: null,
    startedAt: new Date(),
    finishedAt: status === "running" ? null : new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never;
}

describe("routine step executor", () => {
  it("returns a completed step from cache without running the callback", async () => {
    const run = vi.fn();
    const repository = {
      begin: vi.fn().mockResolvedValue({
        acquired: false,
        result: step("completed", { count: 2 }),
      }),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    const result = await createRoutineStepExecutor(repository as never).execute(
      {
        ownerId,
        runId,
        stepKey: "collect",
        run,
      },
    );
    expect(result).toMatchObject({ cached: true, output: { count: 2 } });
    expect(run).not.toHaveBeenCalled();
    expect(repository.complete).not.toHaveBeenCalled();
  });

  it("persists a newly executed result", async () => {
    const repository = {
      begin: vi
        .fn()
        .mockResolvedValue({ acquired: true, result: step("running") }),
      complete: vi.fn().mockResolvedValue(step("completed", { ok: true })),
      fail: vi.fn(),
    };
    const run = vi.fn().mockResolvedValue({ ok: true });
    const result = await createRoutineStepExecutor(repository as never).execute(
      {
        ownerId,
        runId,
        stepKey: "collect",
        run,
      },
    );
    expect(result).toMatchObject({ cached: false, output: { ok: true } });
    expect(repository.complete).toHaveBeenCalledWith({
      ownerId,
      runId,
      stepKey: "collect",
      output: { ok: true },
    });
  });

  it("records failures and rejects concurrent work explicitly", async () => {
    const repository = {
      begin: vi
        .fn()
        .mockResolvedValue({ acquired: true, result: step("running") }),
      complete: vi.fn(),
      fail: vi.fn().mockResolvedValue(step("failed")),
    };
    const error = new Error("provider timeout");
    await expect(
      createRoutineStepExecutor(repository as never).execute({
        ownerId,
        runId,
        stepKey: "collect",
        run: vi.fn().mockRejectedValue(error),
      }),
    ).rejects.toThrow("provider timeout");
    expect(repository.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "Error",
        errorMessage: "provider timeout",
      }),
    );

    const busyRepository = {
      begin: vi
        .fn()
        .mockResolvedValue({ acquired: false, result: step("running") }),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    await expect(
      createRoutineStepExecutor(busyRepository as never).execute({
        ownerId,
        runId,
        stepKey: "collect",
        run: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(RoutineStepExecutionError);
  });
});
