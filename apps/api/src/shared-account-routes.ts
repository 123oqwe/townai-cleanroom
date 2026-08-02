import type { Hono } from "hono";
import { z } from "zod";
import { asId } from "@town/contracts";
import type { SharedAccountRepository } from "@town/teams";
import type { AuthVariables } from "./auth.js";

export interface SharedAccountDependencies {
  repository: SharedAccountRepository;
}
const grantSchema = z
  .object({
    accountId: z.uuidv7(),
    accountOwnerId: z.uuidv7(),
    capabilities: z.array(z.string().trim().min(1).max(100)).max(100),
  })
  .strict();
export function registerSharedAccountRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: SharedAccountDependencies,
): void {
  app.get("/v1/squares/:squareId/accounts", async (context) => {
    const actorId = context.get("identity").user.id;
    return context.json({
      accounts: await dependencies.repository.list(
        actorId,
        asId<"square">(context.req.param("squareId")),
      ),
    });
  });
  app.post("/v1/squares/:squareId/accounts", async (context) => {
    const actorId = context.get("identity").user.id;
    const value = grantSchema.parse(await context.req.json());
    return context.json(
      {
        account: await dependencies.repository.grant({
          actorId,
          squareId: asId<"square">(context.req.param("squareId")),
          accountId: asId<"connected-account">(value.accountId),
          accountOwnerId: asId<"user">(value.accountOwnerId),
          capabilities: value.capabilities,
        }),
      },
      201,
    );
  });
  app.delete("/v1/square-account-shares/:shareId", async (context) => {
    const actorId = context.get("identity").user.id;
    await dependencies.repository.revoke(
      actorId,
      asId<"square-account-share">(context.req.param("shareId")),
    );
    return context.body(null, 204);
  });
}
