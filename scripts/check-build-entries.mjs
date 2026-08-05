import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const packagePaths = execFileSync(
  "git",
  ["ls-files", "-z", "packages", "*/package.json"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter((file) => file.endsWith("/package.json"));

const missing = [];
for (const packagePath of packagePaths) {
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  if (typeof packageJson.main !== "string") continue;
  const entry = `${packagePath.slice(0, -"package.json".length)}${packageJson.main.replace(/^\.\//, "")}`;
  if (!existsSync(entry)) missing.push(entry);
}
if (!existsSync("apps/api/dist/index.js"))
  missing.push("apps/api/dist/index.js");
if (!existsSync("apps/worker/dist/index.js"))
  missing.push("apps/worker/dist/index.js");

if (missing.length > 0) {
  console.error("Build entrypoint check failed:");
  for (const entry of missing) console.error(`- ${entry}`);
  process.exitCode = 1;
} else {
  console.log(
    `Build entrypoint check passed (${packagePaths.length} packages).`,
  );
}
