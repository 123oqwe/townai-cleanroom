import { createHash, randomBytes } from "node:crypto";
import type { Sql } from "postgres";
import { z } from "zod";
import type { Hono } from "hono";

import { asId, newId } from "@town/contracts";
import type { AccountRepository } from "@town/identity";
import type { AuthVariables } from "./auth.js";

const tenant = "common";
const authorizeUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`;
const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
const userInfoUrl = "https://graph.microsoft.com/oidc/userinfo";

const scopes = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "https://graph.microsoft.com/Mail.ReadWrite",
  "https://graph.microsoft.com/Calendars.ReadWrite",
  "https://graph.microsoft.com/Calendars.Read",
];

const userInfoSchema = z
  .object({
    sub: z.string().min(1).max(255),
    email: z.email().optional(),
    preferred_username: z.email().optional(),
    given_name: z.string().optional(),
    family_name: z.string().optional(),
  })
  .passthrough();

const tokenSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    expires_in: z.number().int().positive().optional(),
    scope: z.string().optional(),
  })
  .passthrough();

export interface MicrosoftOAuthDependencies {
  sql: Sql;
  accounts: AccountRepository;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  webOrigin: string;
  fetch?: typeof globalThis.fetch;
}

function hash(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function cookieValue(
  header: string | undefined,
  name: string,
): string | undefined {
  return header
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function notConfigured(context: {
  json: (body: unknown, status?: number) => Response;
}): Response {
  return context.json({ code: "OAUTH_NOT_CONFIGURED" }, 503);
}

export function registerMicrosoftOAuthRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: MicrosoftOAuthDependencies,
): void {
  app.get("/v1/accounts/microsoft/oauth/start", async (context) => {
    if (
      !dependencies.clientId ||
      !dependencies.clientSecret ||
      !dependencies.redirectUri
    )
      return notConfigured(context);
    const ownerId = context.get("identity").user.id;
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = hash(verifier).toString("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await dependencies.sql`
      insert into oauth_connect_states (id,owner_id,provider,state_hash,redirect_uri,expires_at)
      values (${newId<"oauth-connect-state">()},${ownerId},'microsoft',${hash(state)},${dependencies.redirectUri},${expiresAt})
    `;
    const url = new URL(authorizeUrl);
    url.searchParams.set("client_id", dependencies.clientId);
    url.searchParams.set("redirect_uri", dependencies.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("prompt", "select_account");
    context.header(
      "Set-Cookie",
      `town_oauth_ms_verifier=${state}.${verifier}; Path=/auth/microsoft/callback; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
    );
    return context.redirect(url.toString(), 302);
  });

  app.get("/auth/microsoft/callback", async (context) => {
    if (
      !dependencies.clientId ||
      !dependencies.clientSecret ||
      !dependencies.redirectUri
    )
      return notConfigured(context);
    const query = context.req.query();
    if (query["error"]) return context.json({ code: "OAUTH_DENIED" }, 400);
    const code = z.string().min(1).parse(query["code"]);
    const state = z.string().min(1).parse(query["state"]);
    const cookie = cookieValue(
      context.req.header("Cookie"),
      "town_oauth_ms_verifier",
    );
    const [cookieState, verifier] = cookie?.split(".") ?? [];
    if (!verifier || cookieState !== state)
      return context.json({ code: "OAUTH_STATE_MISMATCH" }, 400);
    const result = await dependencies.sql.begin(async (tx) => {
      const [stored] = await tx<
        { id: string; owner_id: string; redirect_uri: string }[]
      >`
        select id,owner_id,redirect_uri from oauth_connect_states
        where provider='microsoft' and state_hash=${hash(state)} and consumed_at is null and expires_at > now()
        for update
      `;
      if (!stored) return null;
      await tx`update oauth_connect_states set consumed_at=now() where id=${stored.id}`;
     return {
       ownerId: asId<"user">(stored.owner_id),
        redirectUri: stored.redirect_uri,
     };
    });
    if (!result) return context.json({ code: "OAUTH_STATE_EXPIRED" }, 400);
    const fetcher = dependencies.fetch ?? globalThis.fetch;
    const tokenResponse = await fetcher(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: dependencies.clientId,
        client_secret: dependencies.clientSecret,
        redirect_uri: result.redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
        scope: scopes.join(" "),
      }),
    });
    if (!tokenResponse.ok)
      return context.json({ code: "OAUTH_TOKEN_EXCHANGE_FAILED" }, 502);
    const tokens = tokenSchema.parse(await tokenResponse.json());
    const userResponse = await fetcher(userInfoUrl, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    if (!userResponse.ok)
      return context.json({ code: "OAUTH_USERINFO_FAILED" }, 502);
    const user = userInfoSchema.parse(await userResponse.json());
    const email = user.email ?? user.preferred_username;
    if (email === undefined)
      return context.json({ code: "OAUTH_EMAIL_MISSING" }, 502);
    await dependencies.accounts.create({
      ownerId: result.ownerId,
      provider: "microsoft",
      providerUserId: user.sub,
      email,
      isPrimary: false,
      capabilities: { mail: true, calendar: true },
      ...(tokens.expires_in === undefined
        ? {}
        : { tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1_000) }),
      credential: {
        accessToken: tokens.access_token,
        ...(tokens.refresh_token === undefined
          ? {}
          : { refreshToken: tokens.refresh_token }),
        scopes,
      },
    });
    const redirect = new URL(
      "/settings/accounts?connected=microsoft",
      dependencies.webOrigin,
    );
    context.header(
      "Set-Cookie",
      "town_oauth_ms_verifier=; Path=/auth/microsoft/callback; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    );
    return context.redirect(redirect.toString(), 302);
  });
}
