import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { findContentViolation, findPathViolation } from "./source-policy.mjs";

const candidateOutput = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
);

const candidates = candidateOutput.split("\0").filter(Boolean);
const violations = [];

for (const filePath of candidates) {
  const pathViolation = findPathViolation(filePath);
  if (pathViolation !== null) {
    violations.push(`${filePath}: ${pathViolation}`);
    continue;
  }

  const content = readFileSync(filePath);
  if (content.includes(0)) continue;

  const contentViolation = findContentViolation(content.toString("utf8"));
  if (contentViolation !== null) {
    violations.push(`${filePath}: ${contentViolation}`);
  }
}

if (violations.length > 0) {
  console.error("Source-only policy violations:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    `Source-only policy passed (${candidates.length} candidate files).`,
  );
}
