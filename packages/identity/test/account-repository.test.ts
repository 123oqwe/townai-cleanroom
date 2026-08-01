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
import { newId } from "@town/contracts";
import { runMigrations } from "@town/db";
import postgres, { type Sql } from "postgres";

import { createAccountRepository } from "../src/account-repository.js";
import { createCredentialCipher } from "../src/credential-cipher.js";

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

const originalSecret = {
  accessToken: "google-access-token",
  refreshToken: "google-refresh-token",
  scopes: ["openid", "email", "gmail.modify"],
};

async function createUser(email: string) {
  const id = newId<"user">();
  await sql`
    insert into users (id, email, timezone, status)
    values (${id}, ${email}, 'Asia/Shanghai', 'active')
  `;
  return id;
}

function repository() {
  return createAccountRepository(
    sql,
    createCredentialCipher(randomBytes(32).toString("base64url")),
  );
}

describe("connected account repository", () => {
  it("atomically creates an account with encrypted credentials and a safe projection", async () => {
    const ownerId = await createUser("owner@example.test");

    const account = await repository().create({
      ownerId,
      provider: "google",
      providerUserId: "google-user-1",
      email: "owner@gmail.test",
      isPrimary: true,
      capabilities: { email: "read_write", calendar: "read_write" },
      tokenExpiresAt: new Date("2026-08-02T01:00:00.000Z"),
      credential: originalSecret,
    });
    const [stored] = await sql<{ envelope: unknown }[]>`
      select credential.envelope
      from oauth_credentials as credential
      join connected_accounts as account on account.credential_id = credential.id
      where account.id = ${account.id}
    `;
    const serialized = JSON.stringify(stored?.envelope);

    expect(account).toMatchObject({
      ownerId,
      provider: "google",
      credentialPresent: true,
      needsReauth: false,
    });
    expect(serialized).not.toContain(originalSecret.accessToken);
    expect(serialized).not.toContain(originalSecret.refreshToken);
    expect(account).not.toHaveProperty("credentialId");
    expect(account).not.toHaveProperty("envelope");
  });

  it("enforces one provider identity per owner", async () => {
    const ownerId = await createUser("owner@example.test");
    const input = {
      ownerId,
      provider: "google" as const,
      providerUserId: "google-user-1",
      email: "owner@gmail.test",
      capabilities: {},
      credential: originalSecret,
    };
    const accounts = repository();

    await accounts.create(input);
    await expect(accounts.create(input)).rejects.toMatchObject({
      code: "ACCOUNT_ALREADY_EXISTS",
    });
  });

  it("lists only the requested owner in deterministic order", async () => {
    const ownerId = await createUser("owner@example.test");
    const otherId = await createUser("other@example.test");
    const accounts = repository();
    await accounts.create({
      ownerId,
      provider: "google",
      providerUserId: "z-user",
      email: "z@example.test",
      capabilities: {},
      credential: originalSecret,
    });
    await accounts.create({
      ownerId,
      provider: "microsoft",
      providerUserId: "a-user",
      email: "a@example.test",
      capabilities: {},
      credential: originalSecret,
    });
    await accounts.create({
      ownerId: otherId,
      provider: "google",
      providerUserId: "other-user",
      email: "other@example.test",
      capabilities: {},
      credential: originalSecret,
    });

    const result = await accounts.listByOwner(ownerId);

    expect(result).toHaveLength(2);
    expect(result.map(({ email }) => email)).toEqual([
      "z@example.test",
      "a@example.test",
    ]);
    expect(result.every((account) => account.ownerId === ownerId)).toBe(true);
  });

  it("rotates credentials without changing their opaque reference", async () => {
    const ownerId = await createUser("owner@example.test");
    const accounts = repository();
    const account = await accounts.create({
      ownerId,
      provider: "google",
      providerUserId: "google-user-1",
      email: "owner@gmail.test",
      capabilities: {},
      credential: originalSecret,
    });
    const [before] = await sql<{ credential_id: string; envelope: unknown }[]>`
      select account.credential_id, credential.envelope
      from connected_accounts as account
      join oauth_credentials as credential on credential.id = account.credential_id
      where account.id = ${account.id}
    `;

    await accounts.rotateCredential(ownerId, account.id, {
      ...originalSecret,
      accessToken: "rotated-access-token",
    });
    const [after] = await sql<{ credential_id: string; envelope: unknown }[]>`
      select account.credential_id, credential.envelope
      from connected_accounts as account
      join oauth_credentials as credential on credential.id = account.credential_id
      where account.id = ${account.id}
    `;

    expect(after?.credential_id).toBe(before?.credential_id);
    expect(after?.envelope).not.toEqual(before?.envelope);
    expect(JSON.stringify(after?.envelope)).not.toContain(
      "rotated-access-token",
    );
  });

  it("deletes the account and its credential only for the owner", async () => {
    const ownerId = await createUser("owner@example.test");
    const otherId = await createUser("other@example.test");
    const accounts = repository();
    const account = await accounts.create({
      ownerId,
      provider: "google",
      providerUserId: "google-user-1",
      email: "owner@gmail.test",
      capabilities: {},
      credential: originalSecret,
    });

    await expect(accounts.remove(otherId, account.id)).rejects.toMatchObject({
      code: "ACCOUNT_NOT_FOUND",
    });
    await accounts.remove(ownerId, account.id);
    const rows = await sql<
      { account_count: number; credential_count: number }[]
    >`
      select
        (select count(*)::int from connected_accounts) as account_count,
        (select count(*)::int from oauth_credentials) as credential_count
    `;

    expect(rows[0]?.account_count).toBe(0);
    expect(rows[0]?.credential_count).toBe(0);
  });
});
