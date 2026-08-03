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
import { newId } from "@town/contracts";
import {
  createAccountRepository,
  createCredentialCipher,
  createIdentityService,
} from "@town/identity";
import postgres, { type Sql } from "postgres";

import { createApp } from "../src/app.js";
import { createChannelRepository } from "@town/channels";
import { createOperationsRepository } from "@town/operations";
import { createBillingRepository } from "@town/billing";

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
    app: createApp({
      sql,
      identityService,
      accountRepository,
      channelRepository: createChannelRepository(sql),
      operationsRepository: createOperationsRepository(sql),
      billingRepository: createBillingRepository(sql),
      adminAllowlistEmails: ["owner@example.test"],
    }),
    identityService,
    owner,
    other,
  };
}

describe("protected identity API", () => {
  it("establishes a bearer session only for an allowlisted email", async () => {
    await sql`
      insert into access_allowlist (email, enabled)
      values ('signin@example.test', true)
    `;
    const identityService = createIdentityService(sql);
    const app = createApp({
      identityService,
      accountRepository: createAccountRepository(
        sql,
        createCredentialCipher(randomBytes(32).toString("base64url")),
      ),
    });
    const response = await app.request("/v1/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "signin@example.test",
        firstName: "Sign",
        timezone: "Asia/Shanghai",
      }),
    });
    const body = (await response.json()) as {
      token: string;
      user: { email: string; firstName?: string };
      session: { expiresAt: string };
    };
    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      user: { email: "signin@example.test", firstName: "Sign" },
      session: { expiresAt: expect.any(String) },
    });
    expect(body.token).toMatch(/^town_session_/);
    expect(JSON.stringify(body)).not.toContain("accessToken");
  });

  it("does not establish a session for an unallowlisted email", async () => {
    const identityService = createIdentityService(sql);
    const app = createApp({
      identityService,
      accountRepository: createAccountRepository(
        sql,
        createCredentialCipher(randomBytes(32).toString("base64url")),
      ),
    });
    const response = await app.request("/v1/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "not-allowed@example.test" }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "ACCESS_DENIED" });
  });

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

  it("protects credential mutation routes, not only account listing", async () => {
    const { app, owner } = await fixture();
    const accountResponse = await app.request("/v1/accounts", {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    const account = (await accountResponse.json()) as {
      accounts: Array<{ id: string }>;
    };
    const response = await app.request(
      `/v1/accounts/${account.accounts[0]?.id}/credential`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accessToken: "should-not-reach-route",
          scopes: [],
        }),
      },
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("rejects a revoked session", async () => {
    const { app, identityService, owner } = await fixture();
    await identityService.revokeSession(owner.session.id, owner.user.id);

    const response = await app.request("/v1/accounts", {
      headers: { Authorization: `Bearer ${owner.token}` },
    });

    expect(response.status).toBe(401);
  });

  it("protects notification delivery replay routes", async () => {
    const { app } = await fixture();
    const response = await app.request(
      "/v1/notification-deliveries/01900000-0000-7000-8000-000000000000/replay",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: "replay-unauthenticated" }),
      },
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("protects the notification timeline route", async () => {
    const { app } = await fixture();
    const response = await app.request("/v1/notification-timeline");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
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

  it("exposes safe agent health only to the deployment admin allowlist", async () => {
    const { app, owner, other } = await fixture();
    const overviewResponse = await app.request("/v1/admin/overview", {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(overviewResponse.status).toBe(200);
    expect(await overviewResponse.json()).toMatchObject({
      readiness: {
        api: true,
        harness: false,
        worker: false,
        googleOAuth: false,
      },
      counts: {
        users: { total: 2, active: 2 },
        connectedAccounts: 2,
        activeSessions: 0,
        queuedRuns: 0,
        failedRuns: 0,
        pendingApprovals: 0,
        queuedDeliveries: 0,
        failedDeliveries: 0,
        activeSquares: 0,
        failedAuditEvents24h: 0,
      },
    });
    const response = await app.request(
      `/v1/admin/agent-health/${other.user.id}`,
      { headers: { Authorization: `Bearer ${owner.token}` } },
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      user: { id: other.user.id, email: other.user.email, status: "active" },
      readiness: {
        api: true,
        harness: false,
        worker: false,
        googleOAuth: false,
      },
      summary: {
        activeSessions: 0,
        queuedRuns: 0,
        failedRuns: 0,
        pendingApprovals: 0,
        queuedDeliveries: 0,
        failedDeliveries: 0,
      },
    });
    expect(JSON.stringify(body)).not.toContain(owner.token);

    const detailResponse = await app.request(
      `/v1/admin/users/${other.user.id}`,
      { headers: { Authorization: `Bearer ${owner.token}` } },
    );
    const detail = await detailResponse.json();
    expect(detailResponse.status).toBe(200);
    expect(detail).toMatchObject({
      user: { id: other.user.id, email: other.user.email },
      resources: {
        hasProfile: false,
        activeAgents: 0,
        activeThreads: 0,
        openTasks: 0,
      },
      accounts: [
        {
          provider: "google",
          email: "other@gmail.test",
          isActive: true,
          credentialPresent: true,
        },
      ],
    });

    const squareId = newId<"square">();
    await sql`
      insert into squares (id,owner_id,name,slug,description)
      values (${squareId},${other.user.id},'Admin test team','admin-test-team','Safe team detail')
    `;
    await sql`
      insert into square_memberships (square_id,user_id,owner_id,role,status)
      values (${squareId},${other.user.id},${other.user.id},'owner','active')
    `;
    const teamResponse = await app.request(`/v1/admin/teams/${squareId}`, {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    const team = await teamResponse.json();
    expect(teamResponse.status).toBe(200);
    expect(team).toMatchObject({
      square: { id: squareId, slug: "admin-test-team", status: "active" },
      owner: { id: other.user.id, email: other.user.email },
      membershipCounts: { active: 1, invited: 0, suspended: 0 },
      policy: null,
    });

    const denied = await app.request(
      `/v1/admin/agent-health/${owner.user.id}`,
      { headers: { Authorization: `Bearer ${other.token}` } },
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "ADMIN_NOT_AUTHORIZED" });
  });

  it("keeps admin billing reconciliation explicit when no external provider exists", async () => {
    const { app, owner, other } = await fixture();
    const response = await app.request(
      `/v1/admin/billing-reconciliation/${other.user.id}`,
      { headers: { Authorization: `Bearer ${owner.token}` } },
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      user: { id: other.user.id, email: other.user.email },
      status: "not_configured",
      billing: null,
      usage: [],
      reconciliation: {
        externalProvider: "not_configured",
        discrepancy: null,
      },
    });
  });
});
