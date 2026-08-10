/**
 * Shared post-login redirect path canonicalization.
 *
 * Used by both the API (oidc-login-routes) and the Next.js BFF (google/callback)
 * so there is exactly one redirect policy -- not two divergent checks.
 *
 * Security rules:
 * - trustedWebOrigin must come from configuration (WEB_ORIGIN), never from
 *   request.nextUrl.origin.
 * - Maximum length 2048 characters.
 * - Rejects: backslash, NULL, CR, LF, other control characters, "//",
 *   encoded backslash, encoded protocol-relative paths, absolute URLs,
 *   javascript:, data:, file:, URL username/password, fragment/hash.
 * - Uses new URL(rawPath, trusted) and enforces candidate.origin === trusted.origin.
 * - Only allows paths starting with "/" or "/new".
 */

const MAX_REDIRECT_LENGTH = 2048;

// Characters that must never appear in a redirect path.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\x00-\x1f\x7f\\]/;

export class RedirectValidationError extends Error {
  constructor(
    readonly code: "INVALID_REDIRECT_PATH",
    message: string,
  ) {
    super(message);
    this.name = "RedirectValidationError";
  }
}

/**
 * Normalize and validate a post-login redirect path.
 *
 * @param rawPath - The raw redirect path from user input.
 * @param trustedWebOrigin - The trusted web origin from configuration (WEB_ORIGIN).
 * @returns The validated, safe redirect path.
 * @throws RedirectValidationError if the path is invalid.
 */
export function normalizePostLoginRedirect(
  rawPath: string,
  trustedWebOrigin: string,
): string {
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    throw new RedirectValidationError(
      "INVALID_REDIRECT_PATH",
      "Redirect path is empty.",
    );
  }

  if (rawPath.length > MAX_REDIRECT_LENGTH) {
    throw new RedirectValidationError(
      "INVALID_REDIRECT_PATH",
      "Redirect path exceeds maximum length.",
    );
  }

  // Reject forbidden characters (backslash, control chars, NULL, CR, LF).
  if (FORBIDDEN_CHARS.test(rawPath)) {
    throw new RedirectValidationError(
      "INVALID_REDIRECT_PATH",
      "Redirect path contains forbidden characters.",
    );
  }

  // Reject protocol-relative paths and double slashes.
  if (rawPath.startsWith("//")) {
    throw new RedirectValidationError(
      "INVALID_REDIRECT_PATH",
      "Redirect path must not be protocol-relative.",
    );
  }

  // Reject known dangerous protocol prefixes even if they look like paths.
  const lower = rawPath.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("file:")
  ) {
    throw new RedirectValidationError(
      "INVALID_REDIRECT_PATH",
      "Redirect path uses a forbidden protocol.",
    );
  }

  // Parse against the trusted origin to resolve relative paths.
  let candidate: URL;
  let trusted: URL;
  try {
    trusted = new URL(trustedWebOrigin);
    candidate = new URL(rawPath, trusted);
  } catch {
    throw new RedirectValidationError(
      "INVALID_REDIRECT_PATH",
      "Redirect path could not be parsed.",
    );
  }

  // Enforce same origin: candidate.origin must match trusted.origin.
  if (candidate.origin !== trusted.origin) {
    throw new RedirectValidationError(
      "INVALID_REDIRECT_PATH",
      "Redirect path must be same-origin.",
    );
  }

  // Reject URLs with username/password.
  if (candidate.username !== "" || candidate.password !== "") {
    throw new RedirectValidationError(
      "INVALID_REDIRECT_PATH",
      "Redirect path must not contain credentials.",
    );
  }

  // Reject fragment/hash.
  if (candidate.hash !== "") {
    throw new RedirectValidationError(
      "INVALID_REDIRECT_PATH",
      "Redirect path must not contain a fragment.",
    );
  }

  const pathname = candidate.pathname;

  // Only allow "/" or "/new" or "/new/*".
  if (pathname !== "/" && !pathname.startsWith("/new/")) {
    throw new RedirectValidationError(
      "INVALID_REDIRECT_PATH",
      "Redirect path must start with / or /new/.",
    );
  }

  // Return the safe path (pathname + search, no hash).
  return pathname + candidate.search;
}

/**
 * Safe fallback redirect path. Used when validation fails in contexts
 * where returning an error is not possible (e.g. BFF callback redirect).
 */
export const SAFE_FALLBACK_REDIRECT = "/new/threads";
