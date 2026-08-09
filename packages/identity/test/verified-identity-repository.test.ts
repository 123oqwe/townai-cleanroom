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
import postgres, { type Sql } from "postgres";

import { newId } from "@town/contracts";

import {
  VerifiedIdentityError,
  createVerifiedIdentityRepository,
} from "../src/verified-identity-repository.js";

let sql: Sql;
const now = new Date("2026-08-09T00:00:00Z");

beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 4 });
  await runMigrations(sql);
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  await sql`truncate auth_identities, auth_sessions, users, access_allowlist cascade`;
});

function repo() {
  return createVerifiedIdentityRepository(sql);
}

describe("verified identity repository", () => {
  it("creates a new user + identity on first login", async () => {
    const result = await repo().link({
      provider: "google",
      providerSubject: "sub-1",
      verifiedEmail: "new@example.test",
      emailVerified: true,
      now,
    });
    expect(result.created).toBe(true);
    expect(result.identity.providerSubject).toBe("sub-1");
    expect(result.identity.verifiedEmail).toBe("new@example.test");
  });

  it("reuses existing (provider, subject) on subsequent login", async () => {
    const r = repo();
    await r.link({
      provider: "google",
      providerSubject: "sub-2",
      verifiedEmail: "returning@example.test",
      emailVerified: true,
      now,
    });
    const second = await r.link({
      provider: "google",
      providerSubject: "sub-2",
      verifiedEmail: "returning@example.test",
      emailVerified: true,
      now: new Date("2026-08-10T00:00:00Z"),
    });
    expect(second.created).toBe(false);
    expect(second.identity.lastLoginAt).toEqual(
      new Date("2026-08-10T00:00:00Z"),
    );
  });

  it("links to an existing user by verified email", async () => {
    const r = repo();
    const existingId = newId<"user">();
    await sql`
      insert into users (id, email, timezone, status, created_at, updated_at)
      values (
        ${existingId}, 'existing@example.test', 'UTC', 'active', ${now}, ${now}
      )
    `;
    const result = await r.link({
      provider: "google",
      providerSubject: "sub-3",
      verifiedEmail: "existing@example.test",
      emailVerified: true,
      now,
    });
    expect(result.created).toBe(true);
    expect(result.userId).toBe(existingId);
  });

  it("rejects conflicting identity (different subject owns email)", async () => {
    const r = repo();
    await r.link({
      provider: "google",
      providerSubject: "sub-original",
      verifiedEmail: "conflict@example.test",
      emailVerified: true,
      now,
    });
    await expect(
      r.link({
        provider: "google",
        providerSubject: "sub-different",
        verifiedEmail: "conflict@example.test",
        emailVerified: true,
        now,
      }),
    ).rejects.toMatchObject({
      code: "AUTH_IDENTITY_CONFLICT",
    } satisfies Partial<VerifiedIdentityError>);
  });

  it("findByProviderSubject returns null for unknown", async () => {
    expect(await repo().findByProviderSubject("google", "unknown")).toBeNull();
  });
});
