import { createHash } from "node:crypto";
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

import {
  IdentityError,
  createIdentityService,
} from "../src/identity-service.js";
import { IdentityRepository } from "../src/identity-repository.js";

let sql: Sql;
let now: Date;

beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 4 });
  await runMigrations(sql);
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  await sql`truncate connected_accounts, oauth_credentials, auth_sessions, users, access_allowlist cascade`;
  now = new Date("2026-08-02T00:00:00.000Z");
});

function service() {
  return createIdentityService(sql, {
    now: () => now,
    sessionTtlMs: 60 * 60 * 1_000,
  });
}

async function allow(email: string, enabled = true) {
  await sql`
    insert into access_allowlist (email, enabled)
    values (${email}, ${enabled})
  `;
}

const identityInput = {
  email: "owner@example.test",
  firstName: "Town",
  lastName: "Owner",
  timezone: "Asia/Shanghai",
};

describe("allowlist-gated identity service", () => {
  it.each([
    ["unknown email", false],
    ["disabled email", true],
  ])("denies %s", async (_case, insertDisabled) => {
    if (insertDisabled) await allow(identityInput.email, false);

    await expect(
      service().establishIdentity(identityInput),
    ).rejects.toMatchObject({
      code: "ACCESS_DENIED",
    } satisfies Partial<IdentityError>);
  });

  it("syncs configured allowlist entries idempotently without deleting others", async () => {
    await allow("existing@example.test", false);
    await service().syncAllowlist([identityInput.email, identityInput.email]);
    const rows = await sql<{ email: string; enabled: boolean }[]>`
      select email::text, enabled from access_allowlist order by email
    `;
    expect(rows).toEqual([
      { email: "existing@example.test", enabled: false },
      { email: identityInput.email, enabled: true },
    ]);
  });

  it("matches allowlist email case-insensitively and reuses one user", async () => {
    await allow("OWNER@EXAMPLE.TEST");

    const first = await service().establishIdentity(identityInput);
    const second = await service().establishIdentity(identityInput);
    const rows = await sql<{ count: number }[]>`
      select count(*)::int as count from users
    `;

    expect(first.user.id).toBe(second.user.id);
    expect(first.user.email).toBe(identityInput.email);
    expect(rows[0]?.count).toBe(1);
  });

  it("returns 32 random token bytes and stores only their SHA-256 hashes", async () => {
    await allow(identityInput.email);

    const first = await service().establishIdentity(identityInput);
    const second = await service().establishIdentity(identityInput);
    const tokenBytes = Buffer.from(
      first.token.replace("town_session_", ""),
      "base64url",
    );
    const [stored] = await sql<{ token_hash: Buffer }[]>`
      select token_hash from auth_sessions where id = ${first.session.id}
    `;

    expect(tokenBytes).toHaveLength(32);
    expect(first.token).not.toBe(second.token);
    expect(stored?.token_hash).toEqual(
      createHash("sha256").update(first.token).digest(),
    );
    expect(stored?.token_hash.toString("utf8")).not.toContain(first.token);
  });

  it("authenticates a live session and updates last-seen time", async () => {
    await allow(identityInput.email);
    const established = await service().establishIdentity(identityInput);
    now = new Date("2026-08-02T00:30:00.000Z");

    const authenticated = await service().authenticate(established.token);

    expect(authenticated.user.id).toBe(established.user.id);
    expect(authenticated.session.id).toBe(established.session.id);
    expect(authenticated.session.lastSeenAt).toEqual(now);
  });

  it("treats the configured allowlist as authoritative and disables removed emails", async () => {
    const repository = new IdentityRepository(sql);
    await sql`
      insert into access_allowlist (email, enabled)
      values ('removed@example.invalid', true), ('kept@example.invalid', false)
    `;
    await repository.syncAllowlist(["kept@example.invalid"]);
    const rows = await sql<{ email: string; enabled: boolean }[]>`
      select email::text as email, enabled
      from access_allowlist
      order by email
    `;
    expect(rows).toEqual([
      { email: "kept@example.invalid", enabled: true },
      { email: "removed@example.invalid", enabled: false },
    ]);
  });

  it("rejects expired and malformed session tokens", async () => {
    await allow(identityInput.email);
    const established = await service().establishIdentity(identityInput);
    now = new Date("2026-08-02T02:00:00.000Z");

    await expect(
      service().authenticate(established.token),
    ).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(service().authenticate("malformed")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("revokes only a session owned by the authenticated user", async () => {
    await allow(identityInput.email);
    await allow("other@example.test");
    const owner = await service().establishIdentity(identityInput);
    const other = await service().establishIdentity({
      ...identityInput,
      email: "other@example.test",
    });

    await expect(
      service().revokeSession(owner.session.id, other.user.id),
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    await service().revokeSession(owner.session.id, owner.user.id);
    await expect(service().authenticate(owner.token)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });
});
