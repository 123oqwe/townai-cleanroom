import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import type { NextRequest } from "next/server";

// Phase 01A: same-origin CSRF guard for all state-mutating requests.
// The BFF proxy auto-injects the Bearer token from the cookie, so any
// cross-site request that carries the cookie would be authenticated. This
// guard rejects cross-origin POST/PUT/PATCH/DELETE before they reach the API.

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Canonicalize a URL origin: normalize scheme to lowercase, strip default
 * ports (80 for http, 443 for https), and remove trailing slashes.
 * Example: https://app.example.com:443/ -> https://app.example.com
 */
function canonicalizeOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    const scheme = url.protocol.replace(":", "").toLowerCase();
    const host = url.hostname.toLowerCase();
    const port = url.port;
    // Strip default ports
    const hasDefaultPort =
      (scheme === "https" && port === "443") ||
      (scheme === "http" && port === "80");
    const originStr = hasDefaultPort
      ? `${scheme}://${host}`
      : `${scheme}://${host}${port !== "" ? `:${port}` : ""}`;
    return originStr;
  } catch {
    return origin.trim().toLowerCase();
  }
}

function parseAllowedOrigins(): string[] {
  const raw = process.env.AUTH_ALLOWED_ORIGINS ?? "";
  return raw
    .split(",")
    .map((o) => canonicalizeOrigin(o))
    .filter((o) => o.length > 0);
}

export interface CsrfResult {
  ok: boolean;
  reason?: string;
}

export function assertSameOriginRequest(request: NextRequest): CsrfResult {
  const method = request.method.toUpperCase();
  if (!MUTATION_METHODS.has(method)) return { ok: true };

  const allowed = parseAllowedOrigins();
  if (allowed.length === 0) {
    return { ok: false, reason: "CSRF_REJECTED" };
  }

  const origin = request.headers.get("origin");
  const secFetchSite = request.headers.get("sec-fetch-site");

  if (secFetchSite === "cross-site") {
    return { ok: false, reason: "CSRF_REJECTED" };
  }

  // Require Origin header for all mutations. No host-only fallback.
  // Browsers always send Origin on cross-origin POST/PUT/PATCH/DELETE.
  // Missing Origin on a mutation is treated as a potential CSRF attack.
  if (origin === null) {
    return { ok: false, reason: "CSRF_REJECTED" };
  }

  // Exact-origin comparison: scheme, host, and port must all match.
  // Both sides are canonicalized so https://example.com:443 matches
  // https://example.com. No host-only comparison (same host different
  // port/scheme is rejected).
  const canonicalOrigin = canonicalizeOrigin(origin);
  const ok = allowed.some((a) => safeEqual(a, canonicalOrigin));
  if (!ok) return { ok: false, reason: "CSRF_REJECTED" };
  return { ok: true };
}

export function getBffSharedSecret(): string {
  const secret = process.env.AUTH_BFF_SHARED_SECRET;
  if (secret === undefined || secret.length === 0) {
    throw new Error("AUTH_BFF_SHARED_SECRET is not configured.");
  }
  return secret;
}

export function getInternalApiBaseUrl(): string {
  const url = process.env.INTERNAL_API_BASE_URL;
  if (url === undefined || url.length === 0) {
    throw new Error("INTERNAL_API_BASE_URL is not configured.");
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("INTERNAL_API_BASE_URL must be http(s).");
  }
  return url.replace(/\/$/, "");
}
