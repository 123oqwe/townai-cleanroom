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

import { newId } from "@town/contracts";
import { runMigrations } from "@town/db";
import {
  createAccountRepository,
  createCredentialCipher,
  createIdentityService,
} from "@town/identity";
import {
  createKnowledgeConflictService,
  createKnowledgeSearchRepository,
  createMemoryRepository,
  createPeopleRepository,
  createProfileRepository,
  createRevisionRepository,
  createWikiRepository,
} from "@town/knowledge";

import { createApp } from "../src/app.js";

let sql: Sql;

beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 4 });
  await runMigrations(sql);
});

beforeEach(async () => {
  await sql`truncate table users, access_allowlist cascade`;
});

afterAll(async () => {
  await sql.end();
});

async function fixture() {
  await sql`
    insert into access_allowlist (email, enabled)
    values ('knowledge-owner@example.invalid', true),
           ('knowledge-other@example.invalid', true)
  `;
  const identityService = createIdentityService(sql);
  const accountRepository = createAccountRepository(
    sql,
    createCredentialCipher(randomBytes(32).toString("base64url")),
  );
  const profileRepository = createProfileRepository(sql);
  const memoryRepository = createMemoryRepository(sql);
  const peopleRepository = createPeopleRepository(sql);
  const wikiRepository = createWikiRepository(sql);
  const revisionRepository = createRevisionRepository(sql);
  const knowledgeSearchRepository = createKnowledgeSearchRepository(sql);
  const knowledgeConflictService = createKnowledgeConflictService(sql);
  const owner = await identityService.establishIdentity({
    email: "knowledge-owner@example.invalid",
    timezone: "Asia/Shanghai",
  });
  const other = await identityService.establishIdentity({
    email: "knowledge-other@example.invalid",
    timezone: "UTC",
  });
  const app = createApp({
    identityService,
    accountRepository,
    profileRepository,
    memoryRepository,
    peopleRepository,
    wikiRepository,
    revisionRepository,
    knowledgeSearchRepository,
    knowledgeConflictService,
  });

  return {
    app,
    owner,
    other,
    wikiRepository,
  };
}

function authorization(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

describe("protected knowledge API", () => {
  it("requires authentication and returns stable validation problems", async () => {
    const { app, owner } = await fixture();

    const unauthenticated = await app.request("/v1/profile");
    const invalid = await app.request("/v1/memories", {
      method: "POST",
      headers: authorization(owner.token),
      body: JSON.stringify({ scope: "routine", content: "Missing routine ID" }),
    });

    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      status: 400,
      code: "INVALID_REQUEST",
    });
  });

  it("creates and revises the authenticated profile with API provenance", async () => {
    const { app, owner } = await fixture();
    const headers = authorization(owner.token);
    const created = await app.request("/v1/profile", {
      method: "POST",
      headers,
      body: JSON.stringify({ content: { identity: { role: "Founder" } } }),
    });
    const updated = await app.request("/v1/profile", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        expectedRevision: 1,
        content: { identity: { role: "CEO" } },
      }),
    });
    const stale = await app.request("/v1/profile", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        expectedRevision: 1,
        content: { identity: { role: "Stale edit" } },
      }),
    });
    const history = await app.request("/v1/profile/history", { headers });

    expect(created.status).toBe(201);
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      profile: { currentRevision: 2, content: { identity: { role: "CEO" } } },
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "REVISION_CONFLICT" });
    expect(await history.json()).toMatchObject({
      revisions: [
        { citations: [{ sourceType: "user", sourceRef: "api:profile" }] },
        { citations: [{ sourceType: "user", sourceRef: "api:profile" }] },
      ],
    });
  });

  it("keeps memories, people, and wiki resources owner-isolated", async () => {
    const { app, owner, other } = await fixture();
    const ownerHeaders = authorization(owner.token);
    const otherHeaders = authorization(other.token);
    const memoryResponse = await app.request("/v1/memories", {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        scope: "global",
        content: "Owner launch preference",
      }),
    });
    const personResponse = await app.request("/v1/people", {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        displayName: "Owner Contact",
        category: "coworker",
        notes: "Launch collaborator",
      }),
    });
    const wikiResponse = await app.request("/v1/wiki", {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        kind: "project",
        slug: "launch",
        title: "Launch Project",
        body: "Owner-only launch plan",
      }),
    });
    const memory = (await memoryResponse.json()) as { memory: { id: string } };
    const otherRead = await app.request(`/v1/memories/${memory.memory.id}`, {
      headers: otherHeaders,
    });
    const ownerList = await app.request("/v1/memories", {
      headers: ownerHeaders,
    });
    const otherList = await app.request("/v1/wiki", { headers: otherHeaders });

    expect(memoryResponse.status).toBe(201);
    expect(personResponse.status).toBe(201);
    expect(wikiResponse.status).toBe(201);
    expect(otherRead.status).toBe(404);
    expect(await otherRead.json()).toMatchObject({ code: "MEMORY_NOT_FOUND" });
    expect(JSON.stringify(await ownerList.json())).toContain(
      "Owner launch preference",
    );
    expect(await otherList.json()).toEqual({ documents: [] });
  });

  it("searches real knowledge without exposing private source payloads", async () => {
    const { app, owner } = await fixture();
    const headers = authorization(owner.token);
    await app.request("/v1/wiki", {
      method: "POST",
      headers,
      body: JSON.stringify({
        kind: "project",
        slug: "searchable",
        title: "Searchable Roadmap",
        body: "Verified product roadmap",
      }),
    });

    const response = await app.request(
      "/v1/knowledge/search?q=roadmap&limit=10",
      {
        headers,
      },
    );
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      items: [
        {
          resourceType: "wiki",
          source: { kind: "local_postgresql" },
        },
      ],
    });
    expect(serialized).not.toMatch(
      /accessToken|refreshToken|envelope|credential/,
    );
  });

  it("lists and explicitly resolves a stale system proposal", async () => {
    const { app, owner, wikiRepository } = await fixture();
    const headers = authorization(owner.token);
    const document = await wikiRepository.create({
      ownerId: owner.user.id,
      kind: "project",
      slug: "conflicted",
      title: "Conflicted Project",
      body: "Initial synthesis",
      authorType: "assistant",
      citations: [],
    });
    await app.request(`/v1/wiki/${document.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        expectedRevision: 1,
        kind: "project",
        slug: "conflicted",
        title: "Conflicted Project",
        body: "Owner correction",
      }),
    });
    const proposal = await wikiRepository.update({
      ownerId: owner.user.id,
      documentId: document.id,
      expectedRevision: 1,
      kind: "project",
      slug: "conflicted",
      title: "Conflicted Project",
      body: "Reviewed system proposal",
      authorType: "system",
      citations: [],
    });
    if (proposal.kind !== "conflict") throw new Error("Expected conflict.");

    const conflicts = await app.request("/v1/knowledge/conflicts", { headers });
    const resolution = await app.request(
      `/v1/knowledge/conflicts/${proposal.conflict.id}/resolve`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ expectedRevision: 2, resolution: "accept" }),
      },
    );
    const current = await app.request(`/v1/wiki/${document.id}`, { headers });

    expect(await conflicts.json()).toMatchObject({
      conflicts: [{ id: proposal.conflict.id, status: "pending" }],
    });
    expect(resolution.status).toBe(200);
    expect(await current.json()).toMatchObject({
      document: { body: "Reviewed system proposal", currentRevision: 3 },
    });
  });

  it("returns a stable not-found problem", async () => {
    const { app, owner } = await fixture();
    const response = await app.request(`/v1/wiki/${newId<"wiki">()}`, {
      headers: authorization(owner.token),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      status: 404,
      code: "WIKI_DOCUMENT_NOT_FOUND",
    });
  });
});
