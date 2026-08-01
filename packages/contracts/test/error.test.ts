import { describe, expect, it } from "vitest";

import { problemDetailsSchema } from "../src/error.js";

describe("problem details", () => {
  it("accepts a stable client-safe error envelope", () => {
    const problem = {
      type: "https://town.local/problems/invalid-request",
      title: "Invalid request",
      status: 400,
      detail: "The request body does not match the contract.",
      instance: "/v1/sessions",
      code: "INVALID_REQUEST",
      metadata: { field: "agentId" },
    };

    expect(problemDetailsSchema.parse(problem)).toEqual(problem);
  });

  it.each([399, 600, 400.5])("rejects invalid HTTP status %s", (status) => {
    expect(() =>
      problemDetailsSchema.parse({
        title: "Invalid status",
        status,
        code: "INVALID_STATUS",
      }),
    ).toThrow();
  });

  it("rejects unstable lowercase machine codes", () => {
    expect(() =>
      problemDetailsSchema.parse({
        title: "Invalid code",
        status: 400,
        code: "invalid-code",
      }),
    ).toThrow();
  });

  it("rejects stack traces and unknown fields", () => {
    expect(() =>
      problemDetailsSchema.parse({
        title: "Internal error",
        status: 500,
        code: "INTERNAL_ERROR",
        stack: "secret stack",
      }),
    ).toThrow();
  });
});
