/**
 * Strict server-authoritative cookie TTL validation.
 *
 * The API must always return a valid cookieMaxAgeSeconds. The BFF must
 * never fall back to a hardcoded TTL (e.g. 7 days). If the API does not
 * return a valid value, the BFF returns 502 SESSION_TTL_INVALID and does
 * NOT set the session cookie.
 */

export class CookieTtlError extends Error {
  constructor(
    readonly code: "SESSION_TTL_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "CookieTtlError";
  }
}

/**
 * Parse and validate the server-authoritative cookie max age.
 *
 * @param value - The raw value from the API response (cookieMaxAgeSeconds).
 * @param maxAbsoluteTtlMs - The configured maximum absolute TTL in milliseconds.
 * @returns The validated max age in seconds.
 * @throws CookieTtlError if the value is invalid.
 */
export function parseServerCookieMaxAge(
  value: unknown,
  maxAbsoluteTtlMs: number,
): number {
  if (value === undefined || value === null) {
    throw new CookieTtlError(
      "SESSION_TTL_INVALID",
      "Server did not return cookieMaxAgeSeconds.",
    );
  }

  if (typeof value !== "number") {
    throw new CookieTtlError(
      "SESSION_TTL_INVALID",
      "cookieMaxAgeSeconds is not a number.",
    );
  }

  if (!Number.isSafeInteger(value)) {
    throw new CookieTtlError(
      "SESSION_TTL_INVALID",
      "cookieMaxAgeSeconds is not a safe integer.",
    );
  }

  if (value <= 0) {
    throw new CookieTtlError(
      "SESSION_TTL_INVALID",
      "cookieMaxAgeSeconds must be positive.",
    );
  }

  const maxSeconds = Math.floor(maxAbsoluteTtlMs / 1000);
  if (value > maxSeconds) {
    throw new CookieTtlError(
      "SESSION_TTL_INVALID",
      "cookieMaxAgeSeconds exceeds the configured maximum absolute TTL.",
    );
  }

  return value;
}

/**
 * Get the configured maximum absolute TTL from environment.
 * Falls back to 7 days (604800000 ms) if not configured.
 */
export function getMaxAbsoluteTtlMs(): number {
  const raw = process.env.AUTH_SESSION_ABSOLUTE_TTL_MS;
  const parsed = Number(raw);
  if (Number.isSafeInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return 7 * 24 * 60 * 60 * 1_000; // 604800000 ms default
}
