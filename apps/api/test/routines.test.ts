import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import type { AuthVariables } from "../src/auth.js";
import { registerRoutineRoutes } from "../src/routine-routes.js";
import type { RoutineRepository, RoutineSchedule } from "@town/routines";
import { asId } from "@town/contracts";

const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");
const agentId = "01900000-0000-7000-8000-000000000002";
const agentVersionId = "01900000-0000-7000-8000-000000000003";

function appWith(
  repository: RoutineRepository,
): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (context, next) => {
    context.set("identity", {
      user: { id: ownerId },
    } as AuthVariables["identity"]);
    await next();
  });
  registerRoutineRoutes(app, { repository });
  return app;
}

describe("routine routes", () => {
  it("lists owner schedules and creates a validated schedule", async () => {
    const created: RoutineSchedule = {
      id: asId<"routine-schedule">("01900000-0000-7000-8000-000000000004"),
      ownerId,
      agentId: asId<"agent">(agentId),
      agentVersionId: asId<"agent-version">(agentVersionId),
      name: "Morning sync",
      cron: "0 9 * * 1-5",
      timezone: "Asia/Shanghai",
      enabled: true,
      nextRunAt: new Date("2026-08-03T01:00:00.000Z"),
      lastRunAt: null,
      revision: 1,
      createdAt: new Date("2026-08-02T00:00:00.000Z"),
      updatedAt: new Date("2026-08-02T00:00:00.000Z"),
    };
    const repository = {
      list: async (requestedOwner: typeof ownerId) => {
        expect(requestedOwner).toBe(ownerId);
        return [created];
      },
      create: async (input: Record<string, unknown>) => {
        expect(input["ownerId"]).toBe(ownerId);
        expect(input["nextRunAt"]).toBeInstanceOf(Date);
        return created;
      },
    } as unknown as RoutineRepository;
    const app = appWith(repository);

    const list = await app.request("http://town.test/v1/routines");
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { routines: RoutineSchedule[] };
    expect(listBody.routines).toHaveLength(1);

    const response = await app.request("http://town.test/v1/routines", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId,
        agentVersionId,
        name: "Morning sync",
        cron: "0 9 * * 1-5",
        timezone: "Asia/Shanghai",
        nextRunAt: "2026-08-03T01:00:00.000Z",
      }),
    });
    expect(response.status).toBe(201);
    const responseBody = (await response.json()) as {
      routine: RoutineSchedule;
    };
    expect(responseBody.routine.name).toBe("Morning sync");
  });
});
