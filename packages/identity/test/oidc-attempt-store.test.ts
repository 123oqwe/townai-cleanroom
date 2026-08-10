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
import { createHash } from "node:crypto";

import {
  OidcAttemptError,
  createOidcAttemptStore,
} from "../src/oidc-attempt-store.js";
import { createFlowCipher } from "../src/session-flow-cipher.js";

function bindingHashFor(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

let sql: Sql;
const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // 32 bytes b64url

beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 4 });
  await runMigrations(sql);
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  await sql`truncate auth_oidc_attempts cascade`;
});

function store() {
  return createOidcAttemptStore(sql, createFlowCipher(KEY));
}

describe("oidc attempt store", () => {
  it("creates and consumes an attempt, returning verifier + nonce", async () => {
    const s = store();
    await s.create({
      provider: "google",
      flowType: "login",
      state: "state-1",
      nonce: "nonce-1",
      codeVerifier: "verifier-1",
      redirectPath: "/new/threads",
      browserBindingHash: bindingHashFor("binding-test-secret"),
      ttlMs: 60_000,
    });
    const consumed = await s.consume("state-1", "binding-test-secret");
    expect(consumed.codeVerifier).toBe("verifier-1");
    expect(consumed.nonce).toBe("nonce-1");
    expect(consumed.redirectPath).toBe("/new/threads");
  });

  it("rejects replay (second consume throws AUTH_FLOW_REPLAYED)", async () => {
    const s = store();
    await s.create({
      provider: "google",
      flowType: "login",
      state: "state-2",
      nonce: "nonce-2",
      codeVerifier: "verifier-2",
      redirectPath: "/",
      browserBindingHash: bindingHashFor("binding-test-secret"),
      ttlMs: 60_000,
    });
    await s.consume("state-2", "binding-test-secret");
    await expect(s.consume("state-2", "binding-test-secret")).rejects.toMatchObject({
      code: "AUTH_FLOW_REPLAYED",
    } satisfies Partial<OidcAttemptError>);
  });

  it("rejects expired attempts with AUTH_FLOW_EXPIRED", async () => {
    const s = store();
    await s.create({
      provider: "google",
      flowType: "login",
      state: "state-3",
      nonce: "nonce-3",
      codeVerifier: "verifier-3",
      redirectPath: "/",
      browserBindingHash: bindingHashFor("binding-test-secret"),
      ttlMs: 1_000,
    });
    const past = new Date(Date.now() + 10_000);
    await expect(s.consume("state-3", "binding-test-secret", past)).rejects.toMatchObject({
      code: "AUTH_FLOW_EXPIRED",
    } satisfies Partial<OidcAttemptError>);
  });

  it("rejects unknown state with AUTH_STATE_INVALID", async () => {
    const s = store();
    await expect(s.consume("no-such-state")).rejects.toMatchObject({
      code: "AUTH_STATE_INVALID",
    } satisfies Partial<OidcAttemptError>);
  });

  it("concurrent consume of the same state: only one succeeds", async () => {
    const s = store();
    await s.create({
      provider: "google",
      flowType: "login",
      state: "state-race",
      nonce: "nonce-race",
      codeVerifier: "verifier-race",
      redirectPath: "/",
      browserBindingHash: bindingHashFor("binding-test-secret"),
      ttlMs: 60_000,
    });
    const results = await Promise.allSettled([
      s.consume("state-race", "binding-test-secret"),
      s.consume("state-race", "binding-test-secret"),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it("does not store code_verifier in plaintext at rest", async () => {
    const s = store();
    await s.create({
      provider: "google",
      flowType: "login",
      state: "state-plain",
      nonce: "nonce-plain",
      codeVerifier: "secret-verifier-plaintext",
      redirectPath: "/",
      browserBindingHash: bindingHashFor("binding-test-secret"),
      ttlMs: 60_000,
    });
    const stateHashHex = createHash("sha256")
      .update("state-plain", "utf8")
      .digest("hex");
    const [row] = await sql<{ encrypted_code_verifier: unknown }[]>`
      select encrypted_code_verifier from auth_oidc_attempts
      where encode(state_hash, 'hex') = ${stateHashHex}
    `;
    const json = JSON.stringify(row?.encrypted_code_verifier);
    expect(json).not.toContain("secret-verifier-plaintext");
  });

  it("verifies per-browser binding cookie on consume", async () => {
    const s = store();
    const bindingSecret = "test-browser-binding-secret-1234567890";
    const bindingHash = createHash("sha256")
      .update(bindingSecret, "utf8")
      .digest();
    await s.create({
      provider: "google",
      flowType: "login",
      state: "state-binding",
      nonce: "nonce-binding",
      codeVerifier: "verifier-binding",
      redirectPath: "/",
      browserBindingHash: bindingHash,
      ttlMs: 60_000,
    });
    // Correct binding secret: consume succeeds.
    const consumed = await s.consume("state-binding", bindingSecret);
    expect(consumed.codeVerifier).toBe("verifier-binding");
  });

  it("rejects consume with wrong browser binding secret", async () => {
    const s = store();
    const bindingSecret = "correct-binding-secret-1234567890";
    const bindingHash = createHash("sha256")
      .update(bindingSecret, "utf8")
      .digest();
    await s.create({
      provider: "google",
      flowType: "login",
      state: "state-wrong-binding",
      nonce: "nonce-wrong-binding",
      codeVerifier: "verifier-wrong-binding",
      redirectPath: "/",
      browserBindingHash: bindingHash,
      ttlMs: 60_000,
    });
    // Wrong binding secret: consume should throw AUTH_BROWSER_BINDING_INVALID.
    await expect(
      s.consume("state-wrong-binding", "wrong-binding-secret"),
    ).rejects.toMatchObject({
      code: "AUTH_BROWSER_BINDING_INVALID",
    } satisfies Partial<OidcAttemptError>);
  });

  it("rejects consume with missing browser binding secret", async () => {
    const s = store();
    const bindingSecret = "missing-binding-secret-1234567890";
    const bindingHash = createHash("sha256")
      .update(bindingSecret, "utf8")
      .digest();
    await s.create({
      provider: "google",
      flowType: "login",
      state: "state-missing-binding",
      nonce: "nonce-missing-binding",
      codeVerifier: "verifier-missing-binding",
      redirectPath: "/",
      browserBindingHash: bindingHash,
      ttlMs: 60_000,
    });
    // No binding secret: consume should throw AUTH_BROWSER_BINDING_INVALID.
    await expect(s.consume("state-missing-binding")).rejects.toMatchObject({
      code: "AUTH_BROWSER_BINDING_INVALID",
    } satisfies Partial<OidcAttemptError>);
  });
});
