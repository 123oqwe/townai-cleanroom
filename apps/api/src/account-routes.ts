import type { Hono } from "hono";
import { z } from "zod";

import { asId, type Id } from "@town/contracts";
import type { AccountRepository, CredentialSecret } from "@town/identity";
import type { AuthVariables } from "./auth.js";

export interface AccountDependencies {
  repository: AccountRepository;
}

const credentialSchema = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1).optional(),
    scopes: z.array(z.string().min(1)),
  })
  .strict();

function accountId(value: string): Id<"connected-account"> {
  return asId<"connected-account">(z.uuidv7().parse(value));
}

export function registerAccountRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: AccountDependencies,
): void {
  app.get("/v1/accounts", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      accounts: await dependencies.repository.listByOwner(ownerId),
    });
  });

  app.patch("/v1/accounts/:accountId/credential", async (context) => {
    const ownerId = context.get("identity").user.id;
    const credential = credentialSchema.parse(
      await context.req.json(),
    ) as CredentialSecret;
    await dependencies.repository.rotateCredential(
      ownerId,
      accountId(context.req.param("accountId")),
      credential,
    );
    return context.body(null, 204);
  });

  app.delete("/v1/accounts/:accountId", async (context) => {
    const ownerId = context.get("identity").user.id;
    await dependencies.repository.remove(
      ownerId,
      accountId(context.req.param("accountId")),
    );
    return context.body(null, 204);
  });
}
