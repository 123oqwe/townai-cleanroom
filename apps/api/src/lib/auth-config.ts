import { Buffer } from "node:buffer";

import type { Environment } from "../config.js";

// Phase 01A: production fail-fast validation for authentication config.
// In production, email-only login must be impossible and all AUTH_* vars
// required for Google OIDC must be present. A misconfiguration that would
// weaken security causes a hard startup failure, never a silent fallback.

export interface AuthConfigValidation {
  ok: boolean;
  errors: string[];
}

export function validateProductionAuthConfig(
  env: Environment,
  nodeEnv: string = process.env["NODE_ENV"] ?? "development",
): AuthConfigValidation {
  const errors: string[] = [];
  const isProduction = nodeEnv === "production";

  if (isProduction) {
    // 1. Dev email login must be impossible in production.
    if (env.DEV_EMAIL_LOGIN_ENABLED) {
      errors.push(
        "DEV_EMAIL_LOGIN_ENABLED=true is forbidden in production. Email-only session creation is not allowed.",
      );
    }
    // 2. All Google OIDC login vars must be configured.
    const required = [
      "AUTH_GOOGLE_CLIENT_ID",
      "AUTH_GOOGLE_CLIENT_SECRET",
      "AUTH_GOOGLE_REDIRECT_URI",
      "AUTH_BFF_SHARED_SECRET",
      "AUTH_FLOW_ENCRYPTION_KEY_BASE64URL",
      "AUTH_ALLOWED_ORIGINS",
    ] as const;
    for (const name of required) {
      const value = env[name];
      if (value === undefined || value === "") {
        errors.push(`Missing required production auth var: ${name}`);
      }
    }
    // 3. AUTH_FLOW_ENCRYPTION_KEY must decode to exactly 32 bytes.
    if (
      env.AUTH_FLOW_ENCRYPTION_KEY_BASE64URL !== undefined &&
      env.AUTH_FLOW_ENCRYPTION_KEY_BASE64URL !== ""
    ) {
      try {
        const key = Buffer.from(
          env.AUTH_FLOW_ENCRYPTION_KEY_BASE64URL,
          "base64url",
        );
        if (key.byteLength !== 32) {
          errors.push(
            "AUTH_FLOW_ENCRYPTION_KEY_BASE64URL must decode to exactly 32 bytes.",
          );
        }
      } catch {
        errors.push(
          "AUTH_FLOW_ENCRYPTION_KEY_BASE64URL is not valid base64url.",
        );
      }
    }
    // 4. AUTH_BFF_SHARED_SECRET must be high-entropy (>= 32 chars).
    if (
      env.AUTH_BFF_SHARED_SECRET !== undefined &&
      env.AUTH_BFF_SHARED_SECRET.length < 32
    ) {
      errors.push(
        "AUTH_BFF_SHARED_SECRET must be at least 32 characters (high-entropy random).",
      );
    }
    // 5. AUTH_ALLOWED_ORIGINS must not be a wildcard.
    if (
      env.AUTH_ALLOWED_ORIGINS !== undefined &&
      env.AUTH_ALLOWED_ORIGINS.includes("*")
    ) {
      errors.push("AUTH_ALLOWED_ORIGINS must not contain a wildcard '*'.");
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Throw on production misconfiguration; no-op in development. */
export function assertProductionAuthConfig(
  env: Environment,
  nodeEnv: string = process.env["NODE_ENV"] ?? "development",
): void {
  const result = validateProductionAuthConfig(env, nodeEnv);
  if (!result.ok) {
    throw new Error(
      `PRODUCTION_AUTH_CONFIG_INVALID:\n${result.errors.join("\n")}`,
    );
  }
}

/** Whether dev email login is allowed (non-production AND explicitly enabled). */
export function devEmailLoginAllowed(
  env: Environment,
  nodeEnv: string = process.env["NODE_ENV"] ?? "development",
): boolean {
  return nodeEnv !== "production" && env.DEV_EMAIL_LOGIN_ENABLED;
}
