import { generateKeyPairSync, createSign, type KeyObject } from "node:crypto";

export interface TestKeyPair {
  kid: string;
  publicKey: KeyObject;
  privateKey: KeyObject;
  jwk: {
    kid: string;
    kty: string;
    alg: string;
    use: string;
    n: string;
    e: string;
  };
}

export async function generateKeyPairForTest(): Promise<TestKeyPair> {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: "jwk" }) as {
    n: string;
    e: string;
  };
  const kid = "test-kid-" + Date.now();
  return {
    kid,
    publicKey,
    privateKey,
    jwk: {
      kid,
      kty: "RSA",
      alg: "RS256",
      use: "sig",
      n: jwk.n,
      e: jwk.e,
    },
  };
}

export function generateJwksResponse(keyPair: TestKeyPair) {
  return { keys: [keyPair.jwk] };
}

export async function generateSignedOidcToken(input: {
  keyPair: TestKeyPair;
  clientId: string;
  email?: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (input.expiresInSeconds ?? 3600);
  const header = { alg: "RS256", typ: "JWT", kid: input.keyPair.kid };
  const payload: Record<string, unknown> = {
    iss: "https://accounts.google.com",
    aud: input.clientId,
    exp,
    iat: now,
    sub: "test-subject",
  };
  if (input.email !== undefined) payload["email"] = input.email;
  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${headerB64}.${payloadB64}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput, "utf8");
  signer.end();
  const signature = signer.sign(input.keyPair.privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}
