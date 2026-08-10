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
import postgres, { type Sql } from "postgres";

import { runMigrations } from "@town/db";
import { createA2ARepository } from "@town/a2a";
import {
  createAccountRepository,
  createCredentialCipher,
  createIdentityService,
} from "@town/identity";

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
  await sql`truncate table connected_accounts, oauth_credentials, auth_sessions, users, access_allowlist, a2a_requests cascade`;
});

async function fixture() {
  await sql`
    insert into access_allowlist (email, enabled)
    values ('a2a-owner@example.test', true), ('a2a-recipient@example.test', true)
  `;
  const identityService = createIdentityService(sql);
  const accountRepository = createAccountRepository(
    sql,
    createCredentialCipher(randomBytes(32).toString("base64url")),
  );
  const a2aRepository = createA2ARepository(sql);
  const owner = await identityService.establishLegacyIdentityForTestOnly({
    email: "a2a-owner@example.test",
    timezone: "Asia/Shanghai",
  });
  const recipient = await identityService.establishLegacyIdentityForTestOnly({
    email: "a2a-recipient@example.test",
    timezone: "UTC",
  });
  const app = createApp({
    identityService,
    accountRepository,
    a2aRepository,
  });
  return { app, owner, recipient };
}

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

describe("protected A2A API", () => {
  it("requires auth on list/create/patch/consent", async () => {
    const { app } = await fixture();
    const unauthenticatedList = await app.request("/v1/a2a/requests");
    const unauthenticatedCreate = await app.request("/v1/a2a/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipientId: "01900000-0000-7000-8000-000000000001",
      }),
    });
    const malformedAuthPatch = await app.request(
      "/v1/a2a/requests/01900000-0000-7000-8000-000000000001",
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer bad",
        },
        body: JSON.stringify({
          status: "accepted",
          expectedRevision: 1,
        }),
      },
    );
    const invalidBearer = await app.request(
      "/v1/a2a/requests/01900000-0000-7000-8000-000000000001/consent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "grant", expectedRevision: 1 }),
      },
    );
    expect(unauthenticatedList.status).toBe(401);
    expect(unauthenticatedCreate.status).toBe(401);
    expect(malformedAuthPatch.status).toBe(401);
    expect(invalidBearer.status).toBe(401);
    expect(await unauthenticatedList.json()).toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("creates a request and lists it for both participants", async () => {
    const { app, owner, recipient } = await fixture();
    const createResponse = await app.request("/v1/a2a/requests", {
      method: "POST",
      headers: headers(owner.token),
      body: JSON.stringify({
        recipientId: recipient.user.id,
        capability: "calendar.find-time",
        request: { window: "next-week", durationMinutes: 45 },
      }),
    });
    const createBody = (await createResponse.json()) as {
      request: { id: string };
    };
    expect(createResponse.status).toBe(201);
    expect(createBody.request).toMatchObject({
      requesterId: owner.user.id,
      recipientId: recipient.user.id,
      capability: "calendar.find-time",
      status: "pending",
      consentStatus: "pending",
      consentScope: [],
      revision: 1,
      consentedBy: null,
      result: null,
      request: { window: "next-week", durationMinutes: 45 },
    });

    const ownerList = await app.request("/v1/a2a/requests", {
      headers: headers(owner.token),
    });
    const recipientList = await app.request("/v1/a2a/requests", {
      headers: headers(recipient.token),
    });
    const ownerBody = (await ownerList.json()) as {
      requests: Array<{ id: string }>;
    };
    const recipientBody = (await recipientList.json()) as {
      requests: Array<{ id: string }>;
    };

    expect(ownerList.status).toBe(200);
    expect(recipientList.status).toBe(200);
    expect(ownerBody.requests).toHaveLength(1);
    expect(recipientBody.requests).toHaveLength(1);
    const ownerRequest = ownerBody.requests[0];
    const recipientRequest = recipientBody.requests[0];

    expect(ownerRequest).toBeDefined();
    expect(recipientRequest).toBeDefined();
    if (ownerRequest === undefined || recipientRequest === undefined) {
      throw new Error("expected request row");
    }
    expect(ownerRequest.id).toBe(createBody.request.id);
    expect(recipientRequest.id).toBe(createBody.request.id);

    const acceptedFilter = await app.request(
      "/v1/a2a/requests?status=accepted",
      {
        headers: headers(owner.token),
      },
    );
    const filtered = (await acceptedFilter.json()) as {
      requests: Array<{ id: string }>;
    };
    expect(acceptedFilter.status).toBe(200);
    expect(filtered.requests).toHaveLength(0);
  });

  it("enforces owner/recipient transitions and CAS revision rules", async () => {
    const { app, owner, recipient } = await fixture();
    const createResponse = await app.request("/v1/a2a/requests", {
      method: "POST",
      headers: headers(owner.token),
      body: JSON.stringify({
        recipientId: recipient.user.id,
        capability: "calendar.book-time",
        request: { window: "tomorrow", timezone: "UTC" },
      }),
    });
    const created = (await createResponse.json()) as {
      request: { id: string };
    };
    const requestId = created.request.id;

    const ownerDeniedRecipientAction = await app.request(
      `/v1/a2a/requests/${requestId}`,
      {
        method: "PATCH",
        headers: headers(owner.token),
        body: JSON.stringify({
          status: "accepted",
          expectedRevision: 1,
        }),
      },
    );
    expect(ownerDeniedRecipientAction.status).toBe(409);

    const accepted = await app.request(`/v1/a2a/requests/${requestId}`, {
      method: "PATCH",
      headers: headers(recipient.token),
      body: JSON.stringify({
        status: "accepted",
        expectedRevision: 1,
      }),
    });
    expect(accepted.status).toBe(200);
    const acceptedBody = (await accepted.json()) as {
      request: { status: string; revision: number };
    };
    expect(acceptedBody.request).toMatchObject({
      status: "accepted",
      revision: 2,
    });

    const staleOwnerCompletion = await app.request(
      `/v1/a2a/requests/${requestId}`,
      {
        method: "PATCH",
        headers: headers(owner.token),
        body: JSON.stringify({
          status: "completed",
          expectedRevision: 1,
        }),
      },
    );
    expect(staleOwnerCompletion.status).toBe(409);

    const completed = await app.request(`/v1/a2a/requests/${requestId}`, {
      method: "PATCH",
      headers: headers(owner.token),
      body: JSON.stringify({
        status: "completed",
        expectedRevision: 2,
        result: { slots: ["2026-08-04T10:00:00.000Z"] },
      }),
    });
    const completedBody = (await completed.json()) as {
      request: {
        status: string;
        revision: number;
        result: { slots: string[] };
      };
    };
    expect(completed.status).toBe(200);
    expect(completedBody.request).toMatchObject({
      status: "completed",
      revision: 3,
      result: { slots: ["2026-08-04T10:00:00.000Z"] },
    });

    const duplicateRecipientPatch = await app.request(
      `/v1/a2a/requests/${requestId}`,
      {
        method: "PATCH",
        headers: headers(recipient.token),
        body: JSON.stringify({
          status: "declined",
          expectedRevision: 3,
        }),
      },
    );
    expect(duplicateRecipientPatch.status).toBe(409);
  });

  it("protects expired pending requests from listing and acceptance", async () => {
    const { app, owner, recipient } = await fixture();
    const createResponse = await app.request("/v1/a2a/requests", {
      method: "POST",
      headers: headers(owner.token),
      body: JSON.stringify({
        recipientId: recipient.user.id,
        capability: "calendar.find-time",
        request: { window: "expired-now" },
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    });
    const { request } = (await createResponse.json()) as {
      request: { id: string };
    };
    const pending = await app.request("/v1/a2a/requests?status=pending", {
      headers: headers(recipient.token),
    });
    const pendingBody = (await pending.json()) as {
      requests: Array<{ id: string }>;
    };
    expect(pending.status).toBe(200);
    expect(pendingBody.requests).toEqual([]);

    const attemptedAcceptance = await app.request(
      `/v1/a2a/requests/${request.id}`,
      {
        method: "PATCH",
        headers: headers(recipient.token),
        body: JSON.stringify({ status: "accepted", expectedRevision: 1 }),
      },
    );
    expect(attemptedAcceptance.status).toBe(409);
  });

  it("supports grant/deny/revoke consent and blocks non-recipients", async () => {
    const { app, owner, recipient } = await fixture();
    const fresh = (await (
      await app.request("/v1/a2a/requests", {
        method: "POST",
        headers: headers(owner.token),
        body: JSON.stringify({
          recipientId: recipient.user.id,
          capability: "calendar.find-time",
          request: { window: "scoped" },
        }),
      })
    ).json()) as { request: { id: string; revision: number } };

    const grant = await app.request(
      `/v1/a2a/requests/${fresh.request.id}/consent`,
      {
        method: "POST",
        headers: headers(recipient.token),
        body: JSON.stringify({
          decision: "grant",
          expectedRevision: fresh.request.revision,
          scope: ["calendar.read", "calendar.availability"],
        }),
      },
    );
    const grantBody = (await grant.json()) as {
      request: {
        status: string;
        consentStatus: string;
        consentScope: string[];
        revision: number;
      };
    };
    expect(grant.status).toBe(200);
    expect(grantBody.request).toMatchObject({
      status: "accepted",
      consentStatus: "granted",
      consentScope: ["calendar.read", "calendar.availability"],
      revision: 2,
    });

    const ownerConsent = await app.request(
      `/v1/a2a/requests/${fresh.request.id}/consent`,
      {
        method: "POST",
        headers: headers(owner.token),
        body: JSON.stringify({
          decision: "revoke",
          expectedRevision: grantBody.request.revision,
        }),
      },
    );
    expect(ownerConsent.status).toBe(409);

    const revoke = await app.request(
      `/v1/a2a/requests/${fresh.request.id}/consent`,
      {
        method: "POST",
        headers: headers(recipient.token),
        body: JSON.stringify({
          decision: "revoke",
          expectedRevision: grantBody.request.revision,
        }),
      },
    );
    const revokeBody = (await revoke.json()) as {
      request: { consentStatus: string; status: string; revision: number };
    };
    expect(revoke.status).toBe(200);
    expect(revokeBody.request).toMatchObject({
      consentStatus: "revoked",
      status: "accepted",
      revision: 3,
    });

    const deniedRequest = (await (
      await app.request("/v1/a2a/requests", {
        method: "POST",
        headers: headers(owner.token),
        body: JSON.stringify({
          recipientId: recipient.user.id,
          capability: "calendar.find-time",
          request: { window: "denied-flow" },
        }),
      })
    ).json()) as { request: { id: string; revision: number } };
    const deny = await app.request(
      `/v1/a2a/requests/${deniedRequest.request.id}/consent`,
      {
        method: "POST",
        headers: headers(recipient.token),
        body: JSON.stringify({
          decision: "deny",
          expectedRevision: deniedRequest.request.revision,
        }),
      },
    );
    const denyBody = (await deny.json()) as {
      request: { status: string; consentStatus: string };
    };
    expect(deny.status).toBe(200);
    expect(denyBody.request).toMatchObject({
      status: "declined",
      consentStatus: "denied",
    });
  });

  it("validates patch and consent contracts", async () => {
    const { app, owner, recipient } = await fixture();
    const created = (await (
      await app.request("/v1/a2a/requests", {
        method: "POST",
        headers: headers(owner.token),
        body: JSON.stringify({
          recipientId: recipient.user.id,
          capability: "calendar.find-time",
          request: { window: "validation" },
        }),
      })
    ).json()) as { request: { id: string } };
    const patchInvalid = await app.request(
      `/v1/a2a/requests/${created.request.id}`,
      {
        method: "PATCH",
        headers: headers(recipient.token),
        body: JSON.stringify({
          status: "accepted",
          expectedRevision: "bad",
        }),
      },
    );
    const consentInvalid = await app.request(
      `/v1/a2a/requests/${created.request.id}/consent`,
      {
        method: "POST",
        headers: headers(recipient.token),
        body: JSON.stringify({
          decision: "grant",
          expectedRevision: 0,
          scope: [""],
        }),
      },
    );
    expect(patchInvalid.status).toBe(400);
    expect(consentInvalid.status).toBe(400);
    expect(await patchInvalid.json()).toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(await consentInvalid.json()).toMatchObject({
      code: "INVALID_REQUEST",
    });
  });
});
