import { Hono } from "hono";

import type { AccountRepository, IdentityService } from "@town/identity";

import { createAuthMiddleware, type AuthVariables } from "./auth.js";

export interface AppDependencies {
  identityService: IdentityService;
  accountRepository: AccountRepository;
}

export function createApp(dependencies?: AppDependencies) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/v1/health", (context) =>
    context.json({
      status: "ok" as const,
      service: "town-api" as const,
      version: process.env["TOWN_API_VERSION"] ?? "0.0.0",
      time: new Date().toISOString(),
    }),
  );

  if (dependencies !== undefined) {
    const authenticate = createAuthMiddleware(dependencies.identityService);
    app.use("/v1/me", authenticate);
    app.use("/v1/accounts", authenticate);

    app.get("/v1/me", (context) => {
      const identity = context.get("identity");
      return context.json({ user: identity.user });
    });

    app.get("/v1/accounts", async (context) => {
      const identity = context.get("identity");
      const accounts = await dependencies.accountRepository.listByOwner(
        identity.user.id,
      );
      return context.json({ accounts });
    });
  }

  return app;
}
