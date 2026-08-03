import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createFileContentStorage } from "../src/content-storage.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("file content storage", () => {
  it("reads a stored blob and infers its content type", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "town-content-"));
    temporaryRoots.push(root);
    await fs.mkdir(path.join(root, "objects"));
    await fs.writeFile(path.join(root, "objects", "hello.txt"), "hello");

    const storage = createFileContentStorage(root);

    await expect(storage.read("objects/hello.txt")).resolves.toEqual({
      body: new TextEncoder().encode("hello"),
      contentType: "text/plain; charset=utf-8",
    });
  });

  it("writes bounded blobs below the configured root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "town-content-"));
    temporaryRoots.push(root);
    const storage = createFileContentStorage(root);

    await storage.write("objects/new.txt", new TextEncoder().encode("new"));

    await expect(
      fs.readFile(path.join(root, "objects", "new.txt"), "utf8"),
    ).resolves.toBe("new");
  });

  it("returns null for a missing object and rejects path traversal", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "town-content-"));
    temporaryRoots.push(root);
    const storage = createFileContentStorage(root);

    await expect(storage.read("missing.bin")).resolves.toBeNull();
    await expect(storage.read("../outside.bin")).rejects.toThrow(
      "CONTENT_STORAGE_PATH_DENIED",
    );
  });

  it("rejects writes through a symlink that escapes the root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "town-content-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "town-outside-"));
    temporaryRoots.push(root, outside);
    await fs.symlink(outside, path.join(root, "escape"), "dir");
    const storage = createFileContentStorage(root);

    await expect(
      storage.write("escape/secret.txt", new TextEncoder().encode("secret")),
    ).rejects.toThrow("CONTENT_STORAGE_PATH_DENIED");
    await expect(
      fs.stat(path.join(outside, "secret.txt")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
