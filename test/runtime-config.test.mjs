import { describe, expect, it } from "vitest";

import { inspectRuntimeConfig } from "../scripts/check-runtime-config.mjs";

describe("runtime configuration preflight", () => {
  it("reports missing required configuration without exposing values", () => {
    const result = inspectRuntimeConfig({});
    expect(result.missingRequired).toEqual([
      "DATABASE_URL",
      "CREDENTIAL_MASTER_KEY_BASE64URL",
      "WEB_ORIGIN",
    ]);
    expect(result.checks).not.toContainEqual(
      expect.objectContaining({ value: expect.anything() }),
    );
  });

  it("accepts a 32-byte key and rejects malformed URLs", () => {
    const result = inspectRuntimeConfig({
      DATABASE_URL: "https://not-postgres.example",
      CREDENTIAL_MASTER_KEY_BASE64URL:
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      WEB_ORIGIN: "https://app.example",
    });
    expect(result.checks).toContainEqual({
      name: "DATABASE_URL",
      status: "invalid",
    });
    expect(result.checks).toContainEqual({
      name: "CREDENTIAL_MASTER_KEY_BASE64URL",
      status: "configured",
    });
  });
});
