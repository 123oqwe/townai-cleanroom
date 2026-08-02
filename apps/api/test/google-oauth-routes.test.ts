import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

import { asId } from "@town/contracts";
import type { AccountRepository } from "@town/identity";
import type { AuthVariables } from "../src/auth.js";
import { registerGoogleOAuthRoutes } from "../src/google-oauth-routes.js";

const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");

function appWith(config: Record<string, unknown> = {}) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (context, next) => {
    context.set("identity", {
      user: { id: ownerId },
    } as AuthVariables["identity"]);
    await next();
  });
  registerGoogleOAuthRoutes(app, {
    sql: vi.fn().mockResolvedValue([]) as never,
    accounts: {} as AccountRepository,
    webOrigin: "http://localhost:4173",
    ...config,
  });
  return app;
}

describe("Google OAuth routes", () => {
  it("returns not_configured instead of pretending to connect", async () => {
    const response = await appWith().request(
      "http://town.test/v1/accounts/google/oauth/start",
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "OAUTH_NOT_CONFIGURED" });
  });

  it("creates a PKCE redirect and transient verifier cookie when configured", async () => {
    const response = await appWith({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "http://localhost:3000/auth/google/callback",
    }).request("http://town.test/v1/accounts/google/oauth/start");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain(
      "code_challenge_method=S256",
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
  });
});
