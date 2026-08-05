import { createPublicKey, verify } from "node:crypto";

export interface OidcClaims {
  iss: string;
  aud: string;
  exp: number;
  email?: string;
  sub?: string;
}

export interface OidcVerifyInput {
  token: string;
  clientId: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

interface JwkKey {
  kid: string;
  kty: string;
  alg: string;
  use: string;
  n: string;
  e: string;
}

interface JwksResponse {
  keys: JwkKey[];
}

function base64UrlDecode(value: string): Buffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad =
    padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64");
}

function decodeJwtParts(token: string): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: Buffer;
  signedData: string;
} {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("MALFORMED_JWT");
  const [headerB64, payloadB64, signatureB64] = parts as [
    string,
    string,
    string,
  ];
  const header = JSON.parse(
    base64UrlDecode(headerB64).toString("utf8"),
  ) as Record<string, unknown>;
  const payload = JSON.parse(
    base64UrlDecode(payloadB64).toString("utf8"),
  ) as Record<string, unknown>;
  const signature = base64UrlDecode(signatureB64);
  return {
    header,
    payload,
    signature,
    signedData: `${headerB64}.${payloadB64}`,
  };
}

async function fetchJwks(
  fetchImpl: typeof globalThis.fetch,
): Promise<JwksResponse> {
  const response = await fetchImpl(GOOGLE_JWKS_URL);
  if (!response.ok) throw new Error(`JWKS_FETCH_FAILED:${response.status}`);
  const body = (await response.json()) as JwksResponse;
  if (!Array.isArray(body.keys)) throw new Error("JWKS_INVALID");
  return body;
}

function jwkToPublicKey(jwk: JwkKey) {
  return createPublicKey({
    key: {
      kty: jwk.kty,
      n: jwk.n,
      e: jwk.e,
    },
    format: "jwk",
  });
}

/**
 * Verifies a Google OIDC JWT issued for Pub/Sub push authentication.
 * Validates signature against Google's published JWKS, then checks
 * iss, aud, and exp claims.
 */
export async function verifyGoogleOidcToken(
  input: OidcVerifyInput,
): Promise<OidcClaims> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  if (fetchImpl === undefined) throw new Error("FETCH_UNAVAILABLE");
  const now = input.now ?? Date.now;
  const { header, payload, signature, signedData } = decodeJwtParts(
    input.token,
  );
  const kid = header["kid"];
  if (typeof kid !== "string") throw new Error("MISSING_KID");
  const alg = header["alg"];
  if (alg !== "RS256") throw new Error("UNSUPPORTED_ALG");

  const jwks = await fetchJwks(fetchImpl);
  const jwk = jwks.keys.find((key) => key.kid === kid);
  if (jwk === undefined) throw new Error("KEY_NOT_FOUND");

  const publicKey = jwkToPublicKey(jwk);
  const valid = verify(
    null,
    Buffer.from(signedData, "utf8"),
    publicKey,
    signature,
  );
  if (!valid) throw new Error("INVALID_SIGNATURE");

  const iss = payload["iss"];
  if (iss !== "https://accounts.google.com" && iss !== "accounts.google.com")
    throw new Error("INVALID_ISS");

  const aud = payload["aud"];
  if (aud !== input.clientId) throw new Error("INVALID_AUD");

  const exp = payload["exp"];
  if (typeof exp !== "number" || exp * 1000 <= now())
    throw new Error("TOKEN_EXPIRED");

  return {
    iss: iss as string,
    aud: aud as string,
    exp,
    ...(typeof payload["email"] === "string"
      ? { email: payload["email"] as string }
      : {}),
    ...(typeof payload["sub"] === "string"
      ? { sub: payload["sub"] as string }
      : {}),
  };
}
