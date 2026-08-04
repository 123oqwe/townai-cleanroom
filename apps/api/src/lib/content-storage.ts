import { promises as fs } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import path from "node:path";

import type { ContentStorage } from "../routes/content-routes.js";

const MAX_CONTENT_BLOB_BYTES = 50 * 1024 * 1024;

export interface S3ContentStorageOptions {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  fetcher?: typeof fetch;
  clock?: () => Date;
}

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

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Uint8Array | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function objectKeyPath(key: string): string {
  const trimmed = key.trim();
  const segments = trimmed.split("/");
  if (
    trimmed.length === 0 ||
    trimmed.startsWith("/") ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  )
    throw new Error("CONTENT_STORAGE_KEY_INVALID");
  return segments.map(awsEncode).join("/");
}

function signedRequest(
  options: S3ContentStorageOptions,
  method: "GET" | "PUT",
  key: string,
  body: Uint8Array,
  contentType: string | undefined,
): { url: string; headers: Record<string, string> } {
  const endpoint = new URL(options.endpoint);
  if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:")
    throw new Error("CONTENT_STORAGE_ENDPOINT_INVALID");
  const encodedKey = objectKeyPath(key);
  const prefix = endpoint.pathname.replace(/\/$/, "");
  const canonicalUri = `${prefix}/${awsEncode(options.bucket)}/${encodedKey}`;
  const url = new URL(endpoint.toString());
  url.pathname = canonicalUri;
  const now = (options.clock ?? (() => new Date()))();
  const date = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const shortDate = date.slice(0, 8);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": date,
  };
  if (contentType !== undefined) headers["content-type"] = contentType;
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((name) => `${name}:${headers[name]?.trim() ?? ""}\n`)
    .join("");
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalRequest = [
    method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${shortDate}/${options.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    date,
    scope,
    sha256(canonicalRequest),
  ].join("\n");
  const signingKey = hmac(
    hmac(
      hmac(hmac(`AWS4${options.secretAccessKey}`, shortDate), options.region),
      "s3",
    ),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");
  headers["authorization"] =
    `AWS4-HMAC-SHA256 Credential=${options.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: url.toString(), headers };
}

export function createS3ContentStorage(
  options: S3ContentStorageOptions,
): ContentStorage {
  const fetcher = options.fetcher ?? fetch;
  if (
    options.bucket.trim().length === 0 ||
    options.region.trim().length === 0 ||
    options.accessKeyId.trim().length === 0 ||
    options.secretAccessKey.length === 0
  )
    throw new Error("CONTENT_STORAGE_CONFIGURATION_INVALID");
  return {
    async read(key) {
      const request = signedRequest(
        options,
        "GET",
        key,
        new Uint8Array(),
        undefined,
      );
      const response = await fetcher(request.url, {
        method: "GET",
        headers: request.headers,
      });
      if (response.status === 404) return null;
      if (!response.ok)
        throw new Error(`CONTENT_STORAGE_READ_FAILED_${response.status}`);
      const body = new Uint8Array(await response.arrayBuffer());
      if (body.byteLength > MAX_CONTENT_BLOB_BYTES)
        throw new Error("CONTENT_STORAGE_BLOB_TOO_LARGE");
      return {
        body,
        contentType:
          response.headers.get("content-type") ?? contentTypeFor(key),
      };
    },
    async write(key, body, contentType) {
      if (body.byteLength > MAX_CONTENT_BLOB_BYTES)
        throw new Error("CONTENT_STORAGE_BLOB_TOO_LARGE");
      const request = signedRequest(options, "PUT", key, body, contentType);
      const response = await fetcher(request.url, {
        method: "PUT",
        headers: request.headers,
        body: Buffer.from(body),
      });
      if (!response.ok)
        throw new Error(`CONTENT_STORAGE_WRITE_FAILED_${response.status}`);
    },
  };
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
