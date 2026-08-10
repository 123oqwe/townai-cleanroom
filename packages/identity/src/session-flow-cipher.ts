import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";

// Phase 01A: short-lived encryption for OIDC code_verifier at rest.
// Uses a dedicated key (AUTH_FLOW_ENCRYPTION_KEY_BASE64URL) that is separate
// from CREDENTIAL_MASTER_KEY_BASE64URL. AES-256-GCM with random 12-byte IV.
// The envelope is stored in auth_oidc_attempts.encrypted_code_verifier.

const base64urlSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/);

const flowEnvelopeSchema = z
  .object({
    v: z.literal(1),
    iv: base64urlSchema,
    ct: base64urlSchema,
    tag: base64urlSchema,
  })
  .strict();

export type FlowEnvelope = z.infer<typeof flowEnvelopeSchema>;

export interface FlowCipher {
  encrypt(plaintext: string): FlowEnvelope;
  decrypt(envelope: FlowEnvelope): string;
  /** Timing-safe constant-time comparison of two base64url strings. */
  constantTimeEqual(a: string, b: string): boolean;
}

export function createFlowCipher(flowKeyBase64url: string): FlowCipher {
  base64urlSchema.parse(flowKeyBase64url);
  const key = Buffer.from(flowKeyBase64url, "base64url");
  if (key.byteLength !== 32) {
    throw new Error(
      "AUTH_FLOW_ENCRYPTION_KEY must decode to exactly 32 bytes.",
    );
  }

  return {
    encrypt(plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ct = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);
      return {
        v: 1,
        iv: iv.toString("base64url"),
        ct: ct.toString("base64url"),
        tag: cipher.getAuthTag().toString("base64url"),
      };
    },

    decrypt(envelope) {
      const value = flowEnvelopeSchema.parse(envelope);
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(value.iv, "base64url"),
      );
      decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
      const pt = Buffer.concat([
        decipher.update(Buffer.from(value.ct, "base64url")),
        decipher.final(),
      ]);
      return pt.toString("utf8");
    },

    constantTimeEqual(a, b) {
      const ba = Buffer.from(a);
      const bb = Buffer.from(b);
      if (ba.byteLength !== bb.byteLength) return false;
      return timingSafeEqual(ba, bb);
    },
  };
}

/** Cryptographically random PKCE code_verifier (43-128 chars, base64url). */
export function generateCodeVerifier(): string {
  return randomBytes(48).toString("base64url");
}

/** S256 code_challenge from a code_verifier. */
export function codeChallengeFromVerifier(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}
