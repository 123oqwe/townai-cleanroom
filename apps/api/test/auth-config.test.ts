import { describe, expect, it } from "vitest";

import {
  assertProductionAuthConfig,
  devEmailLoginAllowed,
  validateProductionAuthConfig,
} from "../src/lib/auth-config.js";
import type { Environment } from "../src/config.js";

function baseEnv(overrides: Partial<Environment> = {}): Environment {
  return {
    DATABASE_URL: "postgres://u:p@localhost:5432/db",
    CREDENTIAL_MASTER_KEY_BASE64URL:
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    ACCESS_ALLOWLIST_EMAILS: "",
    ADMIN_ALLOWLIST_EMAILS: "",
    RESPONSES_API_ENDPOINT: "https://api.openai.com/v1/responses",
    RESPONSES_MODEL: "gpt-5",
    RESPONSES_FALLBACKS_JSON: "[]",
    CODEX_EXEC_ENABLED: false,
    CODEX_SANDBOX_MODE: "read-only",
    WEB_ORIGIN: "http://localhost:4173",
    CHANNEL_CREDENTIALS_JSON: "{}",
    PORT: 3000,
    WORKER_ENABLED: false,
    WORKER_BATCH_SIZE: 10,
    RATE_LIMIT_WINDOW_MS: 60_000,
    RATE_LIMIT_MAX: 60,
    RATE_LIMIT_BACKEND: "memory",
    PIPEDREAM_API_URL: "https://api.pipedream.com/v1/apps",
    CODE_RUNNER_ENABLED: false,
    AUTH_SIGNUP_MODE: "allowlist",
    DEV_EMAIL_LOGIN_ENABLED: false,
    AUTH_SESSION_IDLE_TTL_MS: 900_000,
    AUTH_SESSION_ABSOLUTE_TTL_MS: 604_800_000,
    ...overrides,
  } as Environment;
}

describe("production auth config validation", () => {
  it("passes in development with no auth vars", () => {
    const result = validateProductionAuthConfig(baseEnv(), "development");
    expect(result.ok).toBe(true);
  });

  it("fails in production when DEV_EMAIL_LOGIN_ENABLED=true", () => {
    const result = validateProductionAuthConfig(
      baseEnv({ DEV_EMAIL_LOGIN_ENABLED: true }),
      "production",
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/DEV_EMAIL_LOGIN_ENABLED/);
  });

  it("fails in production when AUTH_GOOGLE_* vars are missing", () => {
    const result = validateProductionAuthConfig(baseEnv(), "production");
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/AUTH_GOOGLE_CLIENT_ID/);
    expect(result.errors.join("\n")).toMatch(/AUTH_BFF_SHARED_SECRET/);
    expect(result.errors.join("\n")).toMatch(/AUTH_FLOW_ENCRYPTION_KEY/);
    expect(result.errors.join("\n")).toMatch(/AUTH_ALLOWED_ORIGINS/);
  });

  it("passes in production when all AUTH_* vars are configured", () => {
    const result = validateProductionAuthConfig(
      baseEnv({
        AUTH_GOOGLE_CLIENT_ID: "id",
        AUTH_GOOGLE_CLIENT_SECRET: "secret",
        AUTH_GOOGLE_REDIRECT_URI:
          "https://app.example.com/api/auth/google/callback",
        AUTH_BFF_SHARED_SECRET: "x".repeat(48),
        AUTH_FLOW_ENCRYPTION_KEY_BASE64URL:
          "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        AUTH_ALLOWED_ORIGINS: "https://app.example.com",
      }),
      "production",
    );
    expect(result.ok).toBe(true);
  });

  it("fails when AUTH_FLOW_ENCRYPTION_KEY is not 32 bytes", () => {
    const result = validateProductionAuthConfig(
      baseEnv({
        AUTH_FLOW_ENCRYPTION_KEY_BASE64URL: "AAAA",
        AUTH_BFF_SHARED_SECRET: "x".repeat(48),
        AUTH_ALLOWED_ORIGINS: "https://app.example.com",
        AUTH_GOOGLE_CLIENT_ID: "id",
        AUTH_GOOGLE_CLIENT_SECRET: "secret",
        AUTH_GOOGLE_REDIRECT_URI: "https://app.example.com/cb",
      }),
      "production",
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/32 bytes/);
  });

  it("fails when AUTH_BFF_SHARED_SECRET is too short", () => {
    const result = validateProductionAuthConfig(
      baseEnv({
        AUTH_BFF_SHARED_SECRET: "short",
        AUTH_FLOW_ENCRYPTION_KEY_BASE64URL:
          "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        AUTH_ALLOWED_ORIGINS: "https://app.example.com",
        AUTH_GOOGLE_CLIENT_ID: "id",
        AUTH_GOOGLE_CLIENT_SECRET: "secret",
        AUTH_GOOGLE_REDIRECT_URI: "https://app.example.com/cb",
      }),
      "production",
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/at least 32 characters/);
  });

  it("fails when AUTH_ALLOWED_ORIGINS is a wildcard", () => {
    const result = validateProductionAuthConfig(
      baseEnv({
        AUTH_BFF_SHARED_SECRET: "x".repeat(48),
        AUTH_FLOW_ENCRYPTION_KEY_BASE64URL:
          "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        AUTH_ALLOWED_ORIGINS: "*",
        AUTH_GOOGLE_CLIENT_ID: "id",
        AUTH_GOOGLE_CLIENT_SECRET: "secret",
        AUTH_GOOGLE_REDIRECT_URI: "https://app.example.com/cb",
      }),
      "production",
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/wildcard/);
  });

  it("assertProductionAuthConfig throws in production misconfig", () => {
    expect(() => assertProductionAuthConfig(baseEnv(), "production")).toThrow(
      /PRODUCTION_AUTH_CONFIG_INVALID/,
    );
  });

  it("assertProductionAuthConfig is a no-op in development", () => {
    expect(() =>
      assertProductionAuthConfig(baseEnv(), "development"),
    ).not.toThrow();
  });
});

describe("devEmailLoginAllowed", () => {
  it("is false in production even when enabled", () => {
    expect(
      devEmailLoginAllowed(
        baseEnv({ DEV_EMAIL_LOGIN_ENABLED: true }),
        "production",
      ),
    ).toBe(false);
  });

  it("is false in development when disabled", () => {
    expect(
      devEmailLoginAllowed(
        baseEnv({ DEV_EMAIL_LOGIN_ENABLED: false }),
        "development",
      ),
    ).toBe(false);
  });

  it("is true only in development AND explicitly enabled", () => {
    expect(
      devEmailLoginAllowed(
        baseEnv({ DEV_EMAIL_LOGIN_ENABLED: true }),
        "development",
      ),
    ).toBe(true);
  });
});
