import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

import { asId } from "@town/contracts";
import type { AccountRepository } from "@town/identity";
import type { AuthVariables } from "../src/lib/auth.js";
import { registerGoogleOAuthRoutes } from "../src/oauth/google-oauth-routes.js";

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

function configuredApp(input: {
  sql: ReturnType<typeof vi.fn>;
  accounts: AccountRepository;
  fetch: typeof fetch;
}) {
  return appWith({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "http://localhost:3000/auth/google/callback",
    sql: input.sql,
    accounts: input.accounts,
    fetch: input.fetch,
  });
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

  it("exchanges a callback once and stores the Google account", async () => {
    const stateRow = {
      id: "01900000-0000-7000-8000-000000000002",
      owner_id: ownerId,
      redirect_uri: "https://legacy.example/auth/google/callback",
    };
    let consumed = false;
    const sql = vi.fn();
    sql.mockImplementation(() => []);
    (
      sql as unknown as {
        begin: (callback: (tx: typeof sql) => unknown) => Promise<unknown>;
      }
    ).begin = vi.fn(async (callback: (tx: typeof sql) => unknown) => {
      const tx = vi.fn().mockImplementation(() => {
        if (!consumed) {
          consumed = true;
          return [stateRow];
        }
        return [];
      });
      return callback(tx);
    });
    const create = vi.fn().mockResolvedValue({});
    const accounts = { create } as unknown as AccountRepository;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "google-access-token",
            refresh_token: "google-refresh-token",
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sub: "google-subject",
            email: "person@gmail.com",
            given_name: "Person",
          }),
          { status: 200 },
        ),
      );
    const app = configuredApp({ sql, accounts, fetch });
    const start = await app.request(
      "http://town.test/v1/accounts/google/oauth/start",
    );
    const cookie = start.headers.get("set-cookie");
    const location = new URL(start.headers.get("location") ?? "");
    const callback = await app.request(
      `http://town.test/auth/google/callback?code=one-time-code&state=${location.searchParams.get("state")}`,
      { headers: { Cookie: cookie ?? "" } },
    );

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(
      "http://localhost:4173/settings/accounts?connected=google",
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId,
        provider: "google",
        providerUserId: "google-subject",
        email: "person@gmail.com",
        capabilities: { gmail: true, calendar: true },
        credential: expect.objectContaining({
          accessToken: "google-access-token",
          refreshToken: "google-refresh-token",
        }),
      }),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      body: expect.any(URLSearchParams),
    });
    const tokenRequest = fetch.mock.calls[0]?.[1];
    expect(
      tokenRequest &&
        typeof tokenRequest === "object" &&
        "body" in tokenRequest &&
        tokenRequest.body instanceof URLSearchParams
        ? tokenRequest.body.get("redirect_uri")
        : undefined,
    ).toBe("https://legacy.example/auth/google/callback");

    const replay = await app.request(
      `http://town.test/auth/google/callback?code=one-time-code&state=${location.searchParams.get("state")}`,
      { headers: { Cookie: cookie ?? "" } },
    );
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({ code: "OAUTH_STATE_EXPIRED" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
