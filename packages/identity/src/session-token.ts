import { createHash, randomBytes } from "node:crypto";

const sessionPrefix = "town_session_";
const sessionTokenPattern = /^town_session_[A-Za-z0-9_-]{43}$/;

export function generateSessionToken(): string {
  return `${sessionPrefix}${randomBytes(32).toString("base64url")}`;
}

export function isSessionToken(value: string): boolean {
  return sessionTokenPattern.test(value);
}

export function hashSessionToken(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
