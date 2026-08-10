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
  sql = postgres(inject("postgresUrl"), { max: 20 });
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

it("rejects email change when new email belongs to a different user", async () => {
  const r = repo();
  // Create first identity with email A
  await r.link({
    provider: "google",
    providerSubject: "sub-email-a",
    verifiedEmail: "email-a@example.test",
    emailVerified: true,
    now,
  });
  // Create second user with email B
  const otherUserId = newId<"user">();
  await sql`
      insert into users (id, email, timezone, status, created_at, updated_at)
      values (${otherUserId}, 'email-b@example.test', 'UTC', 'active', ${now}, ${now})
    `;
  await r.link({
    provider: "google",
    providerSubject: "sub-email-b",
    verifiedEmail: "email-b@example.test",
    emailVerified: true,
    now,
  });
  // Now try to change sub-email-a's email to email-b
  await expect(
    r.link({
      provider: "google",
      providerSubject: "sub-email-a",
      verifiedEmail: "email-b@example.test",
      emailVerified: true,
      now,
    }),
  ).rejects.toMatchObject({
    code: "AUTH_IDENTITY_EMAIL_CONFLICT",
  } satisfies Partial<VerifiedIdentityError>);
});

it("allows email change when new email is not owned by another user", async () => {
  const r = repo();
  await r.link({
    provider: "google",
    providerSubject: "sub-email-change-ok",
    verifiedEmail: "old-email@example.test",
    emailVerified: true,
    now,
  });
  const result = await r.link({
    provider: "google",
    providerSubject: "sub-email-change-ok",
    verifiedEmail: "new-email@example.test",
    emailVerified: true,
    now: new Date("2026-08-10T00:00:00Z"),
  });
  expect(result.created).toBe(false);
  expect(result.identity.verifiedEmail).toBe("new-email@example.test");
});

it("2 concurrent same callbacks: only one creates, both succeed", async () => {
  const r = repo();
  const results = await Promise.allSettled([
    r.link({
      provider: "google",
      providerSubject: "sub-concurrent-2",
      verifiedEmail: "concurrent2@example.test",
      emailVerified: true,
      now,
    }),
    r.link({
      provider: "google",
      providerSubject: "sub-concurrent-2",
      verifiedEmail: "concurrent2@example.test",
      emailVerified: true,
      now,
    }),
  ]);
  // Both should succeed (second one reuses existing).
  expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  // Only one user in DB.
  const users =
    await sql`select id from users where email = 'concurrent2@example.test'`;
  expect(users).toHaveLength(1);
  // Only one identity in DB.
  const identities =
    await sql`select id from auth_identities where provider_subject = 'sub-concurrent-2'`;
  expect(identities).toHaveLength(1);
});

it("10 concurrent same callbacks: all succeed, one user, one identity", async () => {
  const r = repo();
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () =>
      r.link({
        provider: "google",
        providerSubject: "sub-concurrent-10",
        verifiedEmail: "concurrent10@example.test",
        emailVerified: true,
        now,
      }),
    ),
  );
  expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  const users =
    await sql`select id from users where email = 'concurrent10@example.test'`;
  expect(users).toHaveLength(1);
  const identities =
    await sql`select id from auth_identities where provider_subject = 'sub-concurrent-10'`;
  expect(identities).toHaveLength(1);
});

it("disabled user is rejected", async () => {
  const r = repo();
  const result = await r.link({
    provider: "google",
    providerSubject: "sub-disabled",
    verifiedEmail: "disabled@example.test",
    emailVerified: true,
    now,
  });
  // Disable the user.
  await sql`update users set status = 'disabled' where id = ${result.userId}`;
  await expect(
    r.link({
      provider: "google",
      providerSubject: "sub-disabled",
      verifiedEmail: "disabled@example.test",
      emailVerified: true,
      now,
    }),
  ).rejects.toMatchObject({
    code: "AUTH_ACCOUNT_DISABLED",
  } satisfies Partial<VerifiedIdentityError>);
});

it("returned user and identity IDs exist in the database", async () => {
  const r = repo();
  const result = await r.link({
    provider: "google",
    providerSubject: "sub-id-check",
    verifiedEmail: "idcheck@example.test",
    emailVerified: true,
    now,
  });
  const [userRow] = await sql`select id from users where id = ${result.userId}`;
  expect(userRow).toBeDefined();
  const [identityRow] =
    await sql`select id from auth_identities where id = ${result.identity.id}`;
  expect(identityRow).toBeDefined();
});

it("no orphan user on transaction failure", async () => {
  const r = repo();
  // Create a user with the target email first.
  const existingUserId = newId<"user">();
  await sql`
      insert into users (id, email, timezone, status, created_at, updated_at)
      values (${existingUserId}, 'orphan-test@example.test', 'UTC', 'active', ${now}, ${now})
    `;
  // Now try to link with a different subject but same email —
  // should succeed and not create an orphan.
  const result = await r.link({
    provider: "google",
    providerSubject: "sub-orphan",
    verifiedEmail: "orphan-test@example.test",
    emailVerified: true,
    now,
  });
  expect(result.userId).toBe(existingUserId);
  // Only one user with this email.
  const users =
    await sql`select id from users where email = 'orphan-test@example.test'`;
  expect(users).toHaveLength(1);
});
