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

function parseOrigin(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.username !== "" || url.password !== "") return null;
    if (url.hash !== "") return null;
    if (url.pathname !== "/" && url.pathname !== "") return null;
    return url;
  } catch {
    return null;
  }
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
      errors.push("DEV_EMAIL_LOGIN_ENABLED=true is forbidden in production.");
    }

    // 2. Required base vars.
    const requiredBase = [
      "DATABASE_URL",
      "CREDENTIAL_MASTER_KEY_BASE64URL",
      "WEB_ORIGIN",
      "INTERNAL_API_BASE_URL",
    ] as const;
    for (const name of requiredBase) {
      const value = env[name] as string | undefined;
      if (value === undefined || value === "") {
        errors.push(`Missing required production var: ${name}`);
      }
    }

    // 3. Required AUTH_* vars.
    const requiredAuth = [
      "AUTH_GOOGLE_CLIENT_ID",
      "AUTH_GOOGLE_CLIENT_SECRET",
      "AUTH_GOOGLE_REDIRECT_URI",
      "AUTH_BFF_SHARED_SECRET",
      "AUTH_FLOW_ENCRYPTION_KEY_BASE64URL",
      "AUTH_ALLOWED_ORIGINS",
    ] as const;
    for (const name of requiredAuth) {
      const value = env[name];
      if (value === undefined || value === "") {
        errors.push(`Missing required production auth var: ${name}`);
      }
    }

    // 4. AUTH_FLOW_ENCRYPTION_KEY must decode to exactly 32 bytes.
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

    // 5. AUTH_BFF_SHARED_SECRET must be high-entropy (>= 32 chars).
    if (
      env.AUTH_BFF_SHARED_SECRET !== undefined &&
      env.AUTH_BFF_SHARED_SECRET.length < 32
    ) {
      errors.push("AUTH_BFF_SHARED_SECRET must be at least 32 characters.");
    }

    // 6. AUTH_ALLOWED_ORIGINS must not be a wildcard.
    if (
      env.AUTH_ALLOWED_ORIGINS !== undefined &&
      env.AUTH_ALLOWED_ORIGINS.includes("*")
    ) {
      errors.push("AUTH_ALLOWED_ORIGINS must not contain a wildcard '*'.");
    }

    // 7. WEB_ORIGIN validation.
    if (env.WEB_ORIGIN !== undefined && env.WEB_ORIGIN !== "") {
      const webOrigin = parseOrigin(env.WEB_ORIGIN);
      if (webOrigin === null) {
        errors.push(
          "WEB_ORIGIN must be a valid http(s) origin without credentials, fragment, or path.",
        );
      } else {
        // 8. AUTH_GOOGLE_REDIRECT_URI must match WEB_ORIGIN origin + /api/auth/google/callback.
        if (
          env.AUTH_GOOGLE_REDIRECT_URI !== undefined &&
          env.AUTH_GOOGLE_REDIRECT_URI !== ""
        ) {
          try {
            const redirectUri = new URL(env.AUTH_GOOGLE_REDIRECT_URI);
            if (redirectUri.origin !== webOrigin.origin) {
              errors.push(
                "AUTH_GOOGLE_REDIRECT_URI origin must match WEB_ORIGIN origin.",
              );
            }
            if (redirectUri.pathname !== "/api/auth/google/callback") {
              errors.push(
                "AUTH_GOOGLE_REDIRECT_URI pathname must be /api/auth/google/callback.",
              );
            }
          } catch {
            errors.push("AUTH_GOOGLE_REDIRECT_URI is not a valid URL.");
          }
        }

        // 9. AUTH_ALLOWED_ORIGINS must contain WEB_ORIGIN.
        if (
          env.AUTH_ALLOWED_ORIGINS !== undefined &&
          env.AUTH_ALLOWED_ORIGINS !== ""
        ) {
          const allowed = env.AUTH_ALLOWED_ORIGINS.split(",")
            .map((o) => o.trim().toLowerCase())
            .filter((o) => o.length > 0);
          const webOriginStr = webOrigin.origin.toLowerCase();
          if (!allowed.includes(webOriginStr)) {
            errors.push("AUTH_ALLOWED_ORIGINS must contain WEB_ORIGIN.");
          }
          // Each entry must be a valid origin (no path, query, fragment).
          for (const o of allowed) {
            try {
              const parsed = new URL(o);
              if (parsed.pathname !== "/" && parsed.pathname !== "") {
                errors.push(
                  `AUTH_ALLOWED_ORIGINS entry '${o}' must not contain a path.`,
                );
              }
              if (parsed.search !== "") {
                errors.push(
                  `AUTH_ALLOWED_ORIGINS entry '${o}' must not contain a query.`,
                );
              }
            } catch {
              errors.push(
                `AUTH_ALLOWED_ORIGINS entry '${o}' is not a valid origin.`,
              );
            }
          }
        }

        // 10. INTERNAL_API_BASE_URL validation.
        if (
          env.INTERNAL_API_BASE_URL !== undefined &&
          env.INTERNAL_API_BASE_URL !== ""
        ) {
          try {
            const internalUrl = new URL(env.INTERNAL_API_BASE_URL);
            if (internalUrl.username !== "" || internalUrl.password !== "") {
              errors.push(
                "INTERNAL_API_BASE_URL must not contain credentials.",
              );
            }
            if (internalUrl.hash !== "") {
              errors.push("INTERNAL_API_BASE_URL must not contain a fragment.");
            }
          } catch {
            errors.push("INTERNAL_API_BASE_URL is not a valid URL.");
          }
        }
      }
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
