const contentRules = [
  {
    name: "private-key-material",
    pattern: new RegExp(["-----BEGIN ", "PRIVATE KEY-----"].join("")),
  },
  {
    name: "github-access-token",
    pattern: new RegExp(["github", "_pat_", "[A-Za-z0-9_]{20,}"].join(""), "i"),
  },
  {
    name: "vercel-access-token",
    pattern: new RegExp(["vc", "k_", "[A-Za-z0-9]{20,}"].join(""), "i"),
  },
  {
    name: "openai-api-key",
    pattern: new RegExp(["s", "k-", "[A-Za-z0-9_-]{20,}"].join("")),
  },
];

export function filterExistingPaths(paths, pathExists) {
  return paths.filter(pathExists);
}

export function findPathViolation(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  const baseName = segments.at(-1) ?? "";

  if (segments.includes(".playwright-cli")) return "browser-capture-directory";
  if (segments.includes(".superpowers")) return "brainstorm-artifact-directory";
  if (segments[0] === "output") return "investigation-output-directory";
  if (baseName === ".env.example") return null;
  if (baseName === ".env" || baseName.startsWith(".env."))
    return "environment-secret-file";
  if (/reverse-engineering/i.test(baseName) || /逆向工程报告/u.test(baseName)) {
    return "reverse-engineering-report";
  }

  return null;
}

export function findContentViolation(content) {
  for (const rule of contentRules) {
    if (rule.pattern.test(content)) return rule.name;
  }

  return null;
}
