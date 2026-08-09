import { createRemoteJWKSet, jwtVerify } from "jose";

// Phase 01A: Google OIDC login ID-token verification.
// This is the AUTHENTICATION OAuth flow (openid + email + profile scopes),
// completely separate from the connected-account Gmail/Calendar OAuth flow.
// Verifies the Google-signed ID token via JWKS (not just userinfo), and
// enforces iss, aud, azp, exp, iat, nonce, email_verified, and sub.

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const GOOGLE_JWKS_URL = new URL("https://www.googleapis.com/oauth2/v3/certs");

// Cache the JWKS client so we don't refetch keys on every verification.
const jwks = createRemoteJWKSet(GOOGLE_JWKS_URL);

export interface VerifiedOidcIdentity {
  subject: string;
  email: string;
  emailVerified: boolean;
  issuer: string;
  audience: string;
}

export class OidcLoginError extends Error {
  constructor(
    readonly code:
      | "AUTH_EMAIL_NOT_VERIFIED"
      | "AUTH_MISSING_EMAIL"
      | "AUTH_NONCE_INVALID"
      | "AUTH_TOKEN_INVALID"
      | "AUTH_TOKEN_EXPIRED",
    message: string,
  ) {
    super(message);
    this.name = "OidcLoginError";
  }
}

export interface VerifyIdTokenInput {
  idToken: string;
  clientId: string;
  expectedNonce: string;
  jwks?: Parameters<typeof jwtVerify>[1];
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

/**
 * Verify a Google OIDC ID token against Google's published JWKS.
 * Returns the verified subject + email. Throws OidcLoginError on any failure.
 */
export async function verifyGoogleLoginIdToken(
  input: VerifyIdTokenInput,
): Promise<VerifiedOidcIdentity> {
  // The default key set is Google's published JWKS. A test can override
  // `jwks` to inject a local issuer key set (LOCAL_OIDC_INTEGRATION_TEST).
  const keySet = input.jwks ?? jwks;
  let payload;
  try {
    // jwtVerify checks signature (JWKS), iss, aud, exp, nbf, iat.
    ({ payload } = await jwtVerify(input.idToken, keySet, {
      issuer: GOOGLE_ISSUERS,
      audience: input.clientId,
      requiredClaims: [
        "iss",
        "aud",
        "exp",
        "iat",
        "sub",
        "email",
        "email_verified",
        "nonce",
      ],
    }));
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code;
    if (code === "ERR_JWT_EXPIRED") {
      throw new OidcLoginError(
        "AUTH_TOKEN_EXPIRED",
        "The ID token has expired.",
      );
    }
    throw new OidcLoginError(
      "AUTH_TOKEN_INVALID",
      "The ID token could not be verified.",
    );
  }

  // nonce: must match the one we generated and stored (one-time use).
  const nonceClaim = payload["nonce"];
  if (typeof nonceClaim !== "string" || nonceClaim !== input.expectedNonce) {
    throw new OidcLoginError("AUTH_NONCE_INVALID", "The nonce did not match.");
  }

  // email_verified must be true.
  if (payload["email_verified"] !== true) {
    throw new OidcLoginError(
      "AUTH_EMAIL_NOT_VERIFIED",
      "The email was not verified by the provider.",
    );
  }

  // email must be present.
  const email = payload["email"];
  if (typeof email !== "string" || email.length === 0) {
    throw new OidcLoginError("AUTH_MISSING_EMAIL", "No email in the ID token.");
  }

  // sub must be present.
  const subject = payload["sub"];
  if (typeof subject !== "string" || subject.length === 0) {
    throw new OidcLoginError(
      "AUTH_TOKEN_INVALID",
      "No subject in the ID token.",
    );
  }

  // azp validation: if azp is present, it must equal our client id
  // (prevents token reuse across Google projects).
  const azp = payload["azp"];
  if (azp !== undefined && azp !== input.clientId) {
    throw new OidcLoginError(
      "AUTH_TOKEN_INVALID",
      "The authorized party did not match.",
    );
  }

  return {
    subject,
    email,
    emailVerified: true,
    issuer: typeof payload["iss"] === "string" ? payload["iss"] : "",
    audience: typeof payload["aud"] === "string" ? payload["aud"] : "",
  };
}

/** Scopes for the authentication OAuth flow (login only). */
export const LOGIN_SCOPES = ["openid", "email", "profile"];
