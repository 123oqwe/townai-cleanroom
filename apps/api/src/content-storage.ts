import { promises as fs } from "node:fs";
import path from "node:path";

import type { ContentStorage } from "./content-routes.js";

const MAX_CONTENT_BLOB_BYTES = 50 * 1024 * 1024;

const contentTypes: Record<string, string> = {
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

function contentTypeFor(key: string): string {
  return (
    contentTypes[path.extname(key).toLowerCase()] ?? "application/octet-stream"
  );
}

export function createFileContentStorage(root: string): ContentStorage {
  const base = path.resolve(root);
  return {
    async read(key) {
      const relative = key.trim();
      if (relative.length === 0 || path.isAbsolute(relative))
        throw new Error("CONTENT_STORAGE_PATH_DENIED");
      const rootReal = await fs.realpath(base).catch(() => base);
      const target = path.resolve(base, relative);
      if (target !== base && !target.startsWith(`${base}${path.sep}`))
        throw new Error("CONTENT_STORAGE_PATH_DENIED");
      const targetReal = await fs.realpath(target).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      });
      if (targetReal === null) return null;
      if (
        targetReal !== rootReal &&
        !targetReal.startsWith(`${rootReal}${path.sep}`)
      )
        throw new Error("CONTENT_STORAGE_PATH_DENIED");
      const stat = await fs.stat(targetReal);
      if (!stat.isFile()) return null;
      if (stat.size > MAX_CONTENT_BLOB_BYTES)
        throw new Error("CONTENT_STORAGE_BLOB_TOO_LARGE");
      return {
        body: new Uint8Array(await fs.readFile(targetReal)),
        contentType: contentTypeFor(relative),
      };
    },
    async write(key, body) {
      const relative = key.trim();
      if (relative.length === 0 || path.isAbsolute(relative))
        throw new Error("CONTENT_STORAGE_PATH_DENIED");
      const target = path.resolve(base, relative);
      if (target !== base && !target.startsWith(`${base}${path.sep}`))
        throw new Error("CONTENT_STORAGE_PATH_DENIED");
      if (body.byteLength > MAX_CONTENT_BLOB_BYTES)
        throw new Error("CONTENT_STORAGE_BLOB_TOO_LARGE");
      await fs.mkdir(path.dirname(target), { recursive: true });
      const rootReal = await fs.realpath(base).catch(() => base);
      const parentReal = await fs.realpath(path.dirname(target));
      if (
        parentReal !== rootReal &&
        !parentReal.startsWith(`${rootReal}${path.sep}`)
      )
        throw new Error("CONTENT_STORAGE_PATH_DENIED");
      const existingTarget = await fs
        .realpath(target)
        .catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw error;
        });
      if (
        existingTarget !== null &&
        existingTarget !== rootReal &&
        !existingTarget.startsWith(`${rootReal}${path.sep}`)
      )
        throw new Error("CONTENT_STORAGE_PATH_DENIED");
      await fs.writeFile(target, body);
    },
  };
}
