import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { newId } from "@town/contracts";

import { createCredentialCipher } from "../src/credential-cipher.js";

function context() {
  return {
    credentialId: newId<"credential">(),
    ownerId: newId<"user">(),
    accountId: newId<"connected-account">(),
    provider: "google",
  };
}

const secret = {
  accessToken: "access-token-value",
  refreshToken: "refresh-token-value",
  scopes: ["openid", "email"],
};

describe("credential cipher", () => {
  it("round-trips credentials using account-bound authenticated data", () => {
    const cipher = createCredentialCipher(
      randomBytes(32).toString("base64url"),
    );
    const binding = context();

    const envelope = cipher.encrypt(secret, binding);

    expect(cipher.decrypt(envelope, binding)).toEqual(secret);
  });

  it("uses a fresh IV for every encryption", () => {
    const cipher = createCredentialCipher(
      randomBytes(32).toString("base64url"),
    );
    const binding = context();

    const first = cipher.encrypt(secret, binding);
    const second = cipher.encrypt(secret, binding);

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("rejects another owner or account binding", () => {
    const cipher = createCredentialCipher(
      randomBytes(32).toString("base64url"),
    );
    const binding = context();
    const envelope = cipher.encrypt(secret, binding);

    expect(() =>
      cipher.decrypt(envelope, { ...binding, ownerId: newId<"user">() }),
    ).toThrow();
  });

  it("rejects a mutated ciphertext", () => {
    const cipher = createCredentialCipher(
      randomBytes(32).toString("base64url"),
    );
    const binding = context();
    const envelope = cipher.encrypt(secret, binding);
    const bytes = Buffer.from(envelope.ciphertext, "base64url");
    bytes[0] = (bytes[0] ?? 0) ^ 1;

    expect(() =>
      cipher.decrypt(
        { ...envelope, ciphertext: bytes.toString("base64url") },
        binding,
      ),
    ).toThrow();
  });

  it("rejects a master key that is not exactly 32 bytes", () => {
    expect(() =>
      createCredentialCipher(randomBytes(31).toString("base64url")),
    ).toThrow();
  });

  it("never serializes plaintext tokens into the envelope", () => {
    const cipher = createCredentialCipher(
      randomBytes(32).toString("base64url"),
    );
    const serialized = JSON.stringify(cipher.encrypt(secret, context()));

    expect(serialized).not.toContain(secret.accessToken);
    expect(serialized).not.toContain(secret.refreshToken);
  });
});
