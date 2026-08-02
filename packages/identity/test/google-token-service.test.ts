import { randomBytes } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
} from "vitest";
import { newId, type Id } from "@town/contracts";
import { runMigrations } from "@town/db";
import postgres, { type Sql } from "postgres";
import { createAccountRepository } from "../src/account-repository.js";
import { createCredentialCipher } from "../src/credential-cipher.js";
import { createGoogleTokenRefresher } from "../src/google-token-service.js";

let sql: Sql;
let ownerId: Id<"user">;

beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 2 });
  await runMigrations(sql);
});
beforeEach(async () => {
  await sql`truncate connected_accounts, oauth_credentials, auth_sessions, users, access_allowlist cascade`;
  ownerId = newId<"user">();
  await sql`insert into users (id,email,timezone,status) values (${ownerId},'refresh@example.invalid','UTC','active')`;
});
afterAll(async () => sql.end());

describe("Google token refresher", () => {
  it("refreshes inside the encrypted credential boundary and returns only the safe account", async () => {
    const accounts = createAccountRepository(
      sql,
      createCredentialCipher(randomBytes(32).toString("base64url")),
    );
    const account = await accounts.create({
      ownerId,
      provider: "google",
      providerUserId: "refresh-user",
      email: "refresh@example.invalid",
      capabilities: { gmail: "read_write" },
      credential: {
        accessToken: "old-access",
        refreshToken: "refresh-secret",
        scopes: ["openid"],
      },
    });
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          JSON.stringify({ access_token: "new-access", expires_in: 3600 }),
          { status: 200 },
        ),
    );
    const refreshed = await createGoogleTokenRefresher({
      accounts,
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch,
    }).refresh(ownerId, account.id);
    expect(refreshed).toMatchObject({
      id: account.id,
      credentialPresent: true,
      needsReauth: false,
    });
    expect(JSON.stringify(refreshed)).not.toContain("new-access");
    expect(fetch).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ method: "POST" }),
    );
    const loaded = await accounts.getCredential(ownerId, account.id);
    expect(loaded.credential).toMatchObject({
      accessToken: "new-access",
      refreshToken: "refresh-secret",
    });
    expect(loaded.account.tokenExpiresAt).not.toBeNull();
  });
});
