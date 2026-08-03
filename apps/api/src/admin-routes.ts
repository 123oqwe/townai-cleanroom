import type { Sql } from "postgres";
import type { Hono } from "hono";
import { z } from "zod";

import type { OperationsRepository } from "@town/operations";
import { asId } from "@town/contracts";
import type { AuthVariables } from "./auth.js";

export interface AdminDependencies {
  sql: Sql;
  operations: OperationsRepository;
  harnessReady: boolean;
  workerEnabled: boolean;
  googleOAuthReady: boolean;
}

const userIdSchema = z.uuidv7();

/**
 * Clean-room administrative health: it reports safe operational counters and
 * readiness, never prompts, credentials, provider payloads, or private Town
 * implementation details.
 */
export function registerAdminRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: AdminDependencies,
): void {
  app.get("/v1/admin/agent-health/:userId", async (context) => {
    const userId = userIdSchema.parse(context.req.param("userId"));
    const [user] = await dependencies.sql<
      { id: string; email: string; status: string; created_at: Date }[]
    >`
      select id,email,status,created_at
      from users
      where id=${userId}
    `;
    if (!user) return context.json({ code: "USER_NOT_FOUND" }, 404);
    const summary = await dependencies.operations.summary(asId<"user">(userId));
    return context.json({
      user: {
        id: user.id,
        email: user.email,
        status: user.status,
        createdAt: user.created_at,
      },
      readiness: {
        api: true,
        harness: dependencies.harnessReady,
        worker: dependencies.workerEnabled,
        googleOAuth: dependencies.googleOAuthReady,
      },
      summary,
    });
  });
}
