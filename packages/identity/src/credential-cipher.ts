import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";

import { idSchema } from "@town/contracts";

const credentialSecretSchema = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1).optional(),
    scopes: z.array(z.string().min(1)),
  })
  .strict();

const credentialContextSchema = z
  .object({
    credentialId: idSchema,
    ownerId: idSchema,
    accountId: idSchema,
    provider: z.string().min(1),
  })
  .strict();

const base64urlSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/);

const credentialEnvelopeSchema = z
  .object({
    version: z.literal(1),
    keyVersion: z.literal(1),
    algorithm: z.literal("A256GCM"),
    iv: base64urlSchema,
    ciphertext: base64urlSchema,
    authTag: base64urlSchema,
  })
  .strict();

export type CredentialSecret = z.infer<typeof credentialSecretSchema>;
export type CredentialContext = z.infer<typeof credentialContextSchema>;
export type CredentialEnvelope = z.infer<typeof credentialEnvelopeSchema>;

export interface CredentialCipher {
  encrypt(
    secret: CredentialSecret,
    context: CredentialContext,
  ): CredentialEnvelope;
  decrypt(
    envelope: CredentialEnvelope,
    context: CredentialContext,
  ): CredentialSecret;
}

function authenticatedData(context: CredentialContext): Buffer {
  const value = credentialContextSchema.parse(context);
  return Buffer.from(
    JSON.stringify([
      value.credentialId,
      value.ownerId,
      value.accountId,
      value.provider,
    ]),
    "utf8",
  );
}

export function createCredentialCipher(
  masterKeyBase64url: string,
): CredentialCipher {
  base64urlSchema.parse(masterKeyBase64url);
  const masterKey = Buffer.from(masterKeyBase64url, "base64url");
  if (masterKey.byteLength !== 32) {
    throw new Error("Credential master key must decode to exactly 32 bytes.");
  }

  return {
    encrypt(secret, context) {
      const plaintext = Buffer.from(
        JSON.stringify(credentialSecretSchema.parse(secret)),
        "utf8",
      );
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
      cipher.setAAD(authenticatedData(context));
      const ciphertext = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ]);

      return {
        version: 1,
        keyVersion: 1,
        algorithm: "A256GCM",
        iv: iv.toString("base64url"),
        ciphertext: ciphertext.toString("base64url"),
        authTag: cipher.getAuthTag().toString("base64url"),
      };
    },

    decrypt(envelope, context) {
      const value = credentialEnvelopeSchema.parse(envelope);
      const decipher = createDecipheriv(
        "aes-256-gcm",
        masterKey,
        Buffer.from(value.iv, "base64url"),
      );
      decipher.setAAD(authenticatedData(context));
      decipher.setAuthTag(Buffer.from(value.authTag, "base64url"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(value.ciphertext, "base64url")),
        decipher.final(),
      ]);
      const decoded: unknown = JSON.parse(plaintext.toString("utf8"));
      return credentialSecretSchema.parse(decoded);
    },
  };
}
