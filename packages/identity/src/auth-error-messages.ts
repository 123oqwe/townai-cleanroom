/**
 * Fixed public auth error messages.
 *
 * Server-side logs may record internal error details, but HTTP responses
 * must use these fixed, safe public messages -- never error.message.
 * This prevents leaking internal state, codes, or PII to clients.
 */

export const AUTH_ERROR_MESSAGES: Readonly<Record<string, string>> =
  Object.freeze({
    AUTH_NOT_CONFIGURED: "Authentication is not configured.",
    AUTH_ACCOUNT_NOT_ALLOWED: "This account is not permitted.",
    AUTH_FLOW_INVALID: "The authentication flow is invalid.",
    AUTH_FLOW_EXPIRED: "The authentication flow has expired.",
    AUTH_FLOW_REPLAYED: "The authentication flow has already been used.",
    AUTH_BROWSER_BINDING_INVALID:
      "The authentication flow could not be verified.",
    AUTH_TOKEN_EXCHANGE_FAILED:
      "The identity provider could not complete authentication.",
    AUTH_IDENTITY_CONFLICT: "The identity could not be linked.",
    AUTH_IDENTITY_EMAIL_CONFLICT:
      "The email is already associated with a different account.",
    SESSION_INVALID: "The session is invalid.",
    UNAUTHORIZED: "Authentication is required.",
    SESSION_NOT_FOUND: "The session was not found.",
    SESSION_EXPIRED: "The session has expired.",
    SESSION_REVOKED: "The session has been revoked.",
    SESSION_ROTATION_CONFLICT: "The session could not be rotated.",
    INVALID_REDIRECT_PATH: "The redirect path is invalid.",
    AUTH_EMAIL_NOT_VERIFIED: "The email was not verified by the provider.",
    AUTH_MISSING_EMAIL: "No email was provided by the identity provider.",
    AUTH_NONCE_INVALID: "The authentication verification failed.",
    AUTH_TOKEN_INVALID: "The authentication token is invalid.",
    AUTH_TOKEN_EXPIRED: "The authentication token has expired.",
  });

/**
 * Get the fixed public message for an auth error code.
 * Falls back to a generic safe message for unknown codes.
 */
export function getAuthErrorMessage(code: string): string {
  return AUTH_ERROR_MESSAGES[code] ?? "An authentication error occurred.";
}
