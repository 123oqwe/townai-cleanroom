import { describe, expect, it } from "vitest";

import {
  filterExistingPaths,
  findContentViolation,
  findPathViolation,
} from "../scripts/source-policy.mjs";

describe("source-only policy", () => {
  it.each([
    ".playwright-cli/page.yml",
    ".superpowers/brainstorm/mockup.html",
    "output/playwright/probe.js",
    ".env.production",
    "TownAI逆向工程报告.md",
  ])("rejects private artifact path %s", (path) => {
    expect(findPathViolation(path)).toBeTypeOf("string");
  });

  it("allows source, migrations, tests, and source-facing documentation", () => {
    expect(findPathViolation("packages/contracts/src/id.ts")).toBeNull();
    expect(findPathViolation("README.md")).toBeNull();
    expect(findPathViolation(".env.example")).toBeNull();
  });

  it.each([
    ["private key", ["-----BEGIN ", "PRIVATE KEY-----"].join("")],
    [
      "GitHub token",
      ["github", "_pat_", "abcdefghijklmnopqrstuvwxyz123456"].join(""),
    ],
    ["Vercel token", ["vc", "k_", "abcdefghijklmnopqrstuvwxyz123456"].join("")],
    ["OpenAI token", ["s", "k-", "abcdefghijklmnopqrstuvwxyz123456"].join("")],
  ])("detects %s without returning its value", (_name, value) => {
    const violation = findContentViolation(value);

    expect(violation).toBeTypeOf("string");
    expect(violation).not.toContain(value);
  });

  it("allows ordinary source text", () => {
    expect(findContentViolation('export const status = "ok";')).toBeNull();
  });

  it("ignores tracked paths deleted from the working tree", () => {
    const existing = new Set(["README.md"]);

    expect(
      filterExistingPaths(["README.md", "deleted.ts"], (path) =>
        existing.has(path),
      ),
    ).toEqual(["README.md"]);
  });
});
