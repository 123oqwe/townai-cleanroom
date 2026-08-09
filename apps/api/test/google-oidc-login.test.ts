import { describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";

import {
  OidcLoginError,
  verifyGoogleLoginIdToken,
} from "../src/lib/google-oidc-login.js";

// LOCAL_OIDC_INTEGRATION_TEST: verify claim logic against a local issuer key.
// Not GOOGLE_LIVE_VERIFIED.

async function makeKeySet() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "test-kid",
    alg: "RS256",
  };
  const keySet = createLocalJWKSet({ keys: [jwk] });
  return { privateKey, keySet };
}

async function makeToken(
  privateKey: webcrypto.CryptoKey,
  claims: {
    iss?: string;
    aud?: string;
    sub?: string;
    nonce?: string;
    email?: string;
    email_verified?: boolean;
    azp?: string;
    expOffsetSec?: number;
  } = {},
) {
  const payload: Record<string, unknown> = {};
  if (claims.nonce !== undefined) payload["nonce"] = claims.nonce;
  if (claims.email !== undefined) payload["email"] = claims.email;
  if (claims.email_verified !== undefined)
    payload["email_verified"] = claims.email_verified;
  if (claims.azp !== undefined) payload["azp"] = claims.azp;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "test-kid" })
    .setIssuer(claims.iss ?? "https://accounts.google.com")
    .setAudience(claims.aud ?? "client-id")
    .setSubject(claims.sub ?? "sub-123")
    .setIssuedAt()
    .setExpirationTime(claims.expOffsetSec ? `${claims.expOffsetSec}s` : "1h")
    .sign(privateKey);
}

const VALID = {
  sub: "sub-123",
  nonce: "nonce-abc",
  email: "user@example.com",
  email_verified: true,
};

describe("google oidc login id-token verification", () => {
  it("verifies a valid token and returns the identity", async () => {
    const { privateKey, keySet } = await makeKeySet();
    const token = await makeToken(privateKey, { ...VALID });
    const result = await verifyGoogleLoginIdToken({
      idToken: token,
      clientId: "client-id",
      expectedNonce: "nonce-abc",
      jwks: keySet,
    });
    expect(result.subject).toBe("sub-123");
    expect(result.email).toBe("user@example.com");
    expect(result.emailVerified).toBe(true);
  });

  it("rejects wrong issuer with AUTH_TOKEN_INVALID", async () => {
    const { privateKey, keySet } = await makeKeySet();
    const token = await makeToken(privateKey, {
      ...VALID,
      iss: "https://evil.example.com",
    });
    await expect(
      verifyGoogleLoginIdToken({
        idToken: token,
        clientId: "client-id",
        expectedNonce: "nonce-abc",
        jwks: keySet,
      }),
    ).rejects.toMatchObject({
      code: "AUTH_TOKEN_INVALID",
    } satisfies Partial<OidcLoginError>);
  });

  it("rejects wrong audience with AUTH_TOKEN_INVALID", async () => {
    const { privateKey, keySet } = await makeKeySet();
    const token = await makeToken(privateKey, {
      ...VALID,
      aud: "wrong-client",
    });
    await expect(
      verifyGoogleLoginIdToken({
        idToken: token,
        clientId: "client-id",
        expectedNonce: "nonce-abc",
        jwks: keySet,
      }),
    ).rejects.toMatchObject({
      code: "AUTH_TOKEN_INVALID",
    } satisfies Partial<OidcLoginError>);
  });

  it("rejects wrong nonce with AUTH_NONCE_INVALID", async () => {
    const { privateKey, keySet } = await makeKeySet();
    const token = await makeToken(privateKey, { ...VALID, nonce: "wrong" });
    await expect(
      verifyGoogleLoginIdToken({
        idToken: token,
        clientId: "client-id",
        expectedNonce: "nonce-abc",
        jwks: keySet,
      }),
    ).rejects.toMatchObject({
      code: "AUTH_NONCE_INVALID",
    } satisfies Partial<OidcLoginError>);
  });

  it("rejects unverified email with AUTH_EMAIL_NOT_VERIFIED", async () => {
    const { privateKey, keySet } = await makeKeySet();
    const token = await makeToken(privateKey, {
      ...VALID,
      email_verified: false,
    });
    await expect(
      verifyGoogleLoginIdToken({
        idToken: token,
        clientId: "client-id",
        expectedNonce: "nonce-abc",
        jwks: keySet,
      }),
    ).rejects.toMatchObject({
      code: "AUTH_EMAIL_NOT_VERIFIED",
    } satisfies Partial<OidcLoginError>);
  });

  it("rejects expired token with AUTH_TOKEN_EXPIRED", async () => {
    const { privateKey, keySet } = await makeKeySet();
    const token = await new SignJWT({
      nonce: "nonce-abc",
      email: "user@example.com",
      email_verified: true,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-kid" })
      .setIssuer("https://accounts.google.com")
      .setAudience("client-id")
      .setSubject("sub-123")
      .setIssuedAt(Date.now() / 1000 - 3600)
      .setExpirationTime(Date.now() / 1000 - 60)
      .sign(privateKey);
    await expect(
      verifyGoogleLoginIdToken({
        idToken: token,
        clientId: "client-id",
        expectedNonce: "nonce-abc",
        jwks: keySet,
      }),
    ).rejects.toMatchObject({
      code: "AUTH_TOKEN_EXPIRED",
    } satisfies Partial<OidcLoginError>);
  });

  it("rejects a token signed by an unknown key with AUTH_TOKEN_INVALID", async () => {
    const other = await generateKeyPair("RS256");
    const token = await makeToken(other.privateKey, { ...VALID });
    const { keySet } = await makeKeySet();
    await expect(
      verifyGoogleLoginIdToken({
        idToken: token,
        clientId: "client-id",
        expectedNonce: "nonce-abc",
        jwks: keySet,
      }),
    ).rejects.toMatchObject({
      code: "AUTH_TOKEN_INVALID",
    } satisfies Partial<OidcLoginError>);
  });

  it("rejects azp mismatch with AUTH_TOKEN_INVALID", async () => {
    const { privateKey, keySet } = await makeKeySet();
    const token = await makeToken(privateKey, { ...VALID, azp: "different" });
    await expect(
      verifyGoogleLoginIdToken({
        idToken: token,
        clientId: "client-id",
        expectedNonce: "nonce-abc",
        jwks: keySet,
      }),
    ).rejects.toMatchObject({
      code: "AUTH_TOKEN_INVALID",
    } satisfies Partial<OidcLoginError>);
  });

  it("rejects a malformed token with AUTH_TOKEN_INVALID", async () => {
    const { keySet } = await makeKeySet();
    await expect(
      verifyGoogleLoginIdToken({
        idToken: "not.a.jwt",
        clientId: "client-id",
        expectedNonce: "nonce",
        jwks: keySet,
      }),
    ).rejects.toMatchObject({
      code: "AUTH_TOKEN_INVALID",
    } satisfies Partial<OidcLoginError>);
  });
});
