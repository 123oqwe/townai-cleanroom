import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";

import {
  createPolicyAwareHarnessTool,
  type HarnessToolBinding,
} from "@town/harness";

const MAX_READ_BYTES = 5 * 1024 * 1024;
const MAX_WRITE_BYTES = 100_000;
const workspaceArguments = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("list"),
      path: z.string().trim().max(2_000).default(""),
      recursive: z.boolean().default(false),
      maxEntries: z.number().int().min(1).max(500).default(100),
    })
    .strict(),
  z
    .object({
      action: z.literal("read"),
      path: z.string().trim().min(1).max(2_000),
      maxChars: z.number().int().min(1).max(50_000).default(20_000),
    })
    .strict(),
  z
    .object({
      action: z.literal("write"),
      path: z.string().trim().min(1).max(2_000),
      content: z.string().max(MAX_WRITE_BYTES),
    })
    .strict(),
  z
    .object({
      action: z.literal("grep"),
      path: z.string().trim().max(2_000).default(""),
      query: z.string().min(1).max(500),
      caseSensitive: z.boolean().default(true),
      maxMatches: z.number().int().min(1).max(100).default(50),
    })
    .strict(),
  z
    .object({
      action: z.literal("copy"),
      source: z.string().trim().min(1).max(2_000),
      destination: z.string().trim().min(1).max(2_000),
    })
    .strict(),
]);

function validateRelativePath(value: string, allowRoot: boolean): string {
  const normalized = value.trim();
  if ((!allowRoot && normalized.length === 0) || path.isAbsolute(normalized))
    throw new Error("WORKSPACE_PATH_DENIED");
  const parts = normalized.split(/[\\/]/);
  if (parts.some((part) => part === ".." || part === "."))
    throw new Error("WORKSPACE_PATH_DENIED");
  return normalized;
}

async function rootRealPath(root: string): Promise<string> {
  return fs.realpath(root).catch(() => {
    throw new Error("WORKSPACE_ROOT_UNAVAILABLE");
  });
}

function inside(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

async function existingPath(root: string, relative: string): Promise<string> {
  const rootReal = await rootRealPath(root);
  const target = path.resolve(root, relative);
  if (!inside(path.resolve(root), target))
    throw new Error("WORKSPACE_PATH_DENIED");
  const resolved = await fs.realpath(target).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error("WORKSPACE_NOT_FOUND");
    throw error;
  });
  if (!inside(rootReal, resolved)) throw new Error("WORKSPACE_PATH_DENIED");
  return resolved;
}

async function writablePath(root: string, relative: string): Promise<string> {
  const rootReal = await rootRealPath(root);
  const target = path.resolve(root, relative);
  if (!inside(path.resolve(root), target))
    throw new Error("WORKSPACE_PATH_DENIED");
  await fs.mkdir(path.dirname(target), { recursive: true });
  const parent = await fs.realpath(path.dirname(target));
  if (!inside(rootReal, parent)) throw new Error("WORKSPACE_PATH_DENIED");
  const targetStat = await fs.lstat(target).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (targetStat?.isSymbolicLink()) throw new Error("WORKSPACE_PATH_DENIED");
  return target;
}

async function listEntries(
  root: string,
  relative: string,
  recursive: boolean,
  maxEntries: number,
) {
  const start = await existingPath(root, relative);
  const output: Array<{
    path: string;
    type: "file" | "directory" | "symlink";
    bytes?: number;
  }> = [];
  async function visit(directory: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (output.length >= maxEntries) return;
      const entryPath = path.join(directory, entry.name);
      const displayPath =
        prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        output.push({ path: displayPath, type: "symlink" });
      } else if (entry.isDirectory()) {
        output.push({ path: displayPath, type: "directory" });
        if (recursive) await visit(entryPath, displayPath);
      } else if (entry.isFile()) {
        const stat = await fs.stat(entryPath);
        output.push({ path: displayPath, type: "file", bytes: stat.size });
      }
    }
  }
  const stat = await fs.stat(start);
  if (!stat.isDirectory()) throw new Error("WORKSPACE_NOT_DIRECTORY");
  await visit(start, relative);
  return output;
}

async function textFiles(
  root: string,
  relative: string,
  maxFiles: number,
): Promise<Array<{ path: string; absolute: string }>> {
  const start = await existingPath(root, relative);
  const output: Array<{ path: string; absolute: string }> = [];
  async function visit(directory: string, prefix: string): Promise<void> {
    if (output.length >= maxFiles) return;
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (output.length >= maxFiles) return;
      const absolute = path.join(directory, entry.name);
      const display =
        prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(absolute, display);
      else if (entry.isFile()) output.push({ path: display, absolute });
    }
  }
  const stat = await fs.stat(start);
  if (stat.isFile()) return [{ path: relative, absolute: start }];
  if (!stat.isDirectory()) throw new Error("WORKSPACE_NOT_DIRECTORY");
  await visit(start, relative);
  return output;
}

async function grepWorkspace(
  root: string,
  relative: string,
  query: string,
  caseSensitive: boolean,
  maxMatches: number,
): Promise<Array<{ path: string; line: number; text: string }>> {
  const files = await textFiles(root, relative, 500);
  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  const matches: Array<{ path: string; line: number; text: string }> = [];
  for (const file of files) {
    const stat = await fs.stat(file.absolute);
    if (stat.size > MAX_READ_BYTES) continue;
    const text = await fs.readFile(file.absolute, "utf8");
    if (text.includes("\u0000")) continue;
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      const haystack = caseSensitive ? line : line.toLocaleLowerCase();
      if (!haystack.includes(needle)) continue;
      matches.push({
        path: file.path,
        line: index + 1,
        text: line.slice(0, 1_000),
      });
      if (matches.length >= maxMatches) return matches;
    }
  }
  return matches;
}

export function createTownWorkspaceHarnessBinding(
  root: string,
): HarnessToolBinding {
  const definition = {
    name: "town_workspace",
    description:
      "List and read files in the configured workspace, or write a file after explicit approval.",
    parameters: {
      type: "object",
      properties: {
        action: { enum: ["list", "read", "write", "grep", "copy"] },
        path: { type: "string", maxLength: 2_000 },
        recursive: { type: "boolean" },
        maxEntries: { type: "integer", minimum: 1, maximum: 500 },
        maxChars: { type: "integer", minimum: 1, maximum: 50_000 },
        content: { type: "string", maxLength: MAX_WRITE_BYTES },
        query: { type: "string", minLength: 1, maxLength: 500 },
        caseSensitive: { type: "boolean" },
        maxMatches: { type: "integer", minimum: 1, maximum: 100 },
        source: { type: "string", maxLength: 2_000 },
        destination: { type: "string", maxLength: 2_000 },
      },
      required: ["action"],
      additionalProperties: false,
    },
  } as const;
  return createPolicyAwareHarnessTool({
    definition,
    decide: (arguments_) => {
      const value = workspaceArguments.safeParse(arguments_);
      if (!value.success) return "deny";
      return value.data.action === "write" || value.data.action === "copy"
        ? "approval_required"
        : "allow";
    },
    async execute(arguments_, context) {
      const value = workspaceArguments.parse(arguments_);
      if (value.action === "list") {
        const relative = validateRelativePath(value.path, true);
        return {
          kind: "result",
          output: JSON.stringify({
            action: "list",
            path: relative,
            entries: await listEntries(
              root,
              relative,
              value.recursive,
              value.maxEntries,
            ),
          }),
        };
      }
      if (value.action === "read") {
        const relative = validateRelativePath(value.path, false);
        const target = await existingPath(root, relative);
        const stat = await fs.stat(target);
        if (!stat.isFile()) throw new Error("WORKSPACE_NOT_FILE");
        if (stat.size > MAX_READ_BYTES)
          throw new Error("WORKSPACE_FILE_TOO_LARGE");
        const text = await fs.readFile(target, "utf8");
        if (text.includes("\u0000"))
          throw new Error("WORKSPACE_BINARY_UNSUPPORTED");
        return {
          kind: "result",
          output: JSON.stringify({
            action: "read",
            path: relative,
            truncated: text.length > value.maxChars,
            text: text.slice(0, value.maxChars),
          }),
        };
      }
      if (value.action === "grep") {
        const relative = validateRelativePath(value.path, true);
        return {
          kind: "result",
          output: JSON.stringify({
            action: "grep",
            path: relative,
            query: value.query,
            matches: await grepWorkspace(
              root,
              relative,
              value.query,
              value.caseSensitive,
              value.maxMatches,
            ),
          }),
        };
      }
      if (!context?.approvalGranted)
        throw new Error("HARNESS_TOOL_APPROVAL_REQUIRED");
      if (value.action === "copy") {
        const sourceRelative = validateRelativePath(value.source, false);
        const destinationRelative = validateRelativePath(
          value.destination,
          false,
        );
        const source = await existingPath(root, sourceRelative);
        const sourceStat = await fs.stat(source);
        if (!sourceStat.isFile()) throw new Error("WORKSPACE_NOT_FILE");
        if (sourceStat.size > MAX_READ_BYTES)
          throw new Error("WORKSPACE_FILE_TOO_LARGE");
        const destination = await writablePath(root, destinationRelative);
        const temporary = `${destination}.town-tmp-${randomUUID()}`;
        try {
          await fs.copyFile(source, temporary);
          await fs.rename(temporary, destination);
        } finally {
          await fs.rm(temporary, { force: true });
        }
        return {
          kind: "result",
          output: JSON.stringify({
            action: "copy",
            source: sourceRelative,
            destination: destinationRelative,
            bytes: sourceStat.size,
          }),
        };
      }
      const relative = validateRelativePath(value.path, false);
      const target = await writablePath(root, relative);
      const temporary = `${target}.town-tmp-${randomUUID()}`;
      try {
        await fs.writeFile(temporary, value.content, "utf8");
        await fs.rename(temporary, target);
      } finally {
        await fs.rm(temporary, { force: true });
      }
      return {
        kind: "result",
        output: JSON.stringify({
          action: "write",
          path: relative,
          bytes: Buffer.byteLength(value.content),
        }),
      };
    },
  });
}
