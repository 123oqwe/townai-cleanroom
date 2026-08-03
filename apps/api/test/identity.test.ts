import { randomBytes } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
} from "vitest";
import { runMigrations } from "@town/db";
import {
  createAccountRepository,
  createCredentialCipher,
  createIdentityService,
} from "@town/identity";
import postgres, { type Sql } from "postgres";

import { createApp } from "../src/app.js";

let sql: Sql;

beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 4 });
  await runMigrations(sql);
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  await sql`truncate connected_accounts, oauth_credentials, auth_sessions, users, access_allowlist cascade`;
});

async function fixture() {
  await sql`
    insert into access_allowlist (email, enabled)
    values ('owner@example.test', true), ('other@example.test', true)
  `;
  const identityService = createIdentityService(sql);
  const accountRepository = createAccountRepository(
    sql,
    createCredentialCipher(randomBytes(32).toString("base64url")),
  );
  const owner = await identityService.establishIdentity({
    email: "owner@example.test",
    firstName: "Town",
    lastName: "Owner",
    timezone: "Asia/Shanghai",
  });
  const other = await identityService.establishIdentity({
    email: "other@example.test",
    timezone: "UTC",
  });
  await accountRepository.create({
    ownerId: owner.user.id,
    provider: "google",
    providerUserId: "owner-google",
    email: "owner@gmail.test",
    capabilities: { email: "read_write" },
    credential: {
      accessToken: "private-access-token",
      refreshToken: "private-refresh-token",
      scopes: ["email"],
    },
  });
  await accountRepository.create({
    ownerId: other.user.id,
    provider: "google",
    providerUserId: "other-google",
    email: "other@gmail.test",
    capabilities: {},
    credential: { accessToken: "other-private-token", scopes: [] },
  });

  return {
    app: createApp({ identityService, accountRepository }),
    identityService,
    owner,
  };
}

describe("protected identity API", () => {
  it.each([undefined, "Basic value", "Bearer malformed"])(
    "rejects missing or invalid authorization %s",
    async (authorization) => {
      const { app } = await fixture();
      const headers =
        authorization === undefined ? {} : { Authorization: authorization };

      const response = await app.request("/v1/me", { headers });

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        status: 401,
        code: "UNAUTHENTICATED",
      });
    },
  );

  it("returns only the authenticated safe user projection", async () => {
    const { app, owner } = await fixture();
    const response = await app.request("/v1/me", {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ user: owner.user });
    expect(JSON.stringify(body)).not.toContain(owner.token);
    expect(body).not.toHaveProperty("session");
  });

  it("lists only owner accounts without credentials or envelopes", async () => {
    const { app, owner } = await fixture();
    const response = await app.request("/v1/accounts", {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    const body = (await response.json()) as {
      accounts: Record<string, unknown>[];
    };
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0]).toMatchObject({
      email: "owner@gmail.test",
      credentialPresent: true,
    });
    expect(serialized).not.toMatch(
      /credentialId|envelope|accessToken|refreshToken/,
    );
    expect(serialized).not.toContain("other@gmail.test");
  });

  it("rejects a revoked session", async () => {
    const { app, identityService, owner } = await fixture();
    await identityService.revokeSession(owner.session.id, owner.user.id);

    const response = await app.request("/v1/accounts", {
      headers: { Authorization: `Bearer ${owner.token}` },
    });

    expect(response.status).toBe(401);
  });

  it("lets the authenticated user revoke the current session", async () => {
    const { app, owner } = await fixture();
    const response = await app.request("/v1/me/session", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(response.status).toBe(204);
    const after = await app.request("/v1/me", {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(after.status).toBe(401);
  });
});
