import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createTownWorkspaceHarnessBinding } from "../src/workspace-tools.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("town workspace harness tool", () => {
  it("lists and reads text files only inside the configured workspace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "town-workspace-"));
    roots.push(root);
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(
      path.join(root, "src", "hello.ts"),
      "export const hello = 1;\n",
    );
    const binding = createTownWorkspaceHarnessBinding(root);

    await expect(
      binding.port.execute({ action: "list", path: "src" }),
    ).resolves.toMatchObject({ kind: "result" });
    await expect(
      binding.port.execute({ action: "read", path: "src/hello.ts" }),
    ).resolves.toMatchObject({
      output: expect.stringContaining("export const hello = 1;"),
    });
  });

  it("requires approval for writes and rejects traversal", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "town-workspace-"));
    roots.push(root);
    const binding = createTownWorkspaceHarnessBinding(root);

    expect(
      binding.port.requiresApproval?.({
        action: "write",
        path: "a.txt",
        content: "a",
      }),
    ).toBe("approval_required");
    await expect(
      binding.port.execute({ action: "write", path: "a.txt", content: "a" }),
    ).rejects.toThrow("HARNESS_TOOL_APPROVAL_REQUIRED");
    await expect(
      binding.port.execute(
        { action: "write", path: "../escape.txt", content: "no" },
        { approvalGranted: true },
      ),
    ).rejects.toThrow("WORKSPACE_PATH_DENIED");
  });

  it("writes atomically after approval and never follows an escaping symlink", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "town-workspace-"));
    const outside = await fs.mkdtemp(
      path.join(os.tmpdir(), "town-workspace-outside-"),
    );
    roots.push(root, outside);
    await fs.symlink(outside, path.join(root, "escape"), "dir");
    const binding = createTownWorkspaceHarnessBinding(root);

    await expect(
      binding.port.execute(
        { action: "write", path: "notes/today.md", content: "today" },
        { approvalGranted: true },
      ),
    ).resolves.toMatchObject({ kind: "result" });
    await expect(
      fs.readFile(path.join(root, "notes", "today.md"), "utf8"),
    ).resolves.toBe("today");
    await expect(
      binding.port.execute(
        { action: "write", path: "escape/leak.txt", content: "no" },
        { approvalGranted: true },
      ),
    ).rejects.toThrow("WORKSPACE_PATH_DENIED");
    await expect(fs.stat(path.join(outside, "leak.txt"))).rejects.toMatchObject(
      { code: "ENOENT" },
    );
  });
});
