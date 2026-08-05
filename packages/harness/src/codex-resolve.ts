import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Probes whether a usable Codex CLI binary is resolvable.
 * Returns false (never throws) so callers can report
 * harnessCodex:false in capabilities rather than crashing.
 */
export function codexBinaryResolvable(explicitPath?: string): boolean {
  if (explicitPath !== undefined && explicitPath.length > 0) {
    return existsSync(explicitPath);
  }
  try {
    const which = execFileSync("which", ["codex"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return which.length > 0 && existsSync(which);
  } catch {
    return false;
  }
}
