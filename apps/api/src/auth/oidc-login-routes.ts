import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import type { Sql } from "postgres";
import { z } from "zod";
import type { Hono } from "hono";

import type { AuthVariables } from "../lib/auth.js";
import {
  OidcLoginError,
  LOGIN_SCOPES,
  verifyGoogleLoginIdToken,
} from "../lib/google-oidc-login.js";
import {
  createFlowCipher,
  createOidcAttemptStore,
  createVerifiedIdentityRepository,
  createSessionManager,
  normalizePostLoginRedirect,
  RedirectValidationError,
  getAuthErrorMessage,
} from "@town/identity";
import { OidcAttemptError } from "@town/identity";

// Phase 01A: Google OIDC login routes. These are called by the Next.js BFF
// (server-to-server) using AUTH_BFF_SHARED_SECRET, never directly by the
// browser. The browser interacts with the BFF's /api/auth/google/* routes.

const ATTEMPT_TTL_MS = 5 * 60 * 1_000; // 5 minutes

export interface OidcLoginDependencies {
  sql: Sql;
  bffSharedSecret: string;
  googleClientId?: string;
  googleClientSecret?: string;
  googleRedirectUri?: string;
  flowEncryptionKey: string;
  allowlistEmails: Set<string>;
  signupMode: "allowlist" | "open";
  idleTtlMs: number;
  absoluteTtlMs: number;
  webOrigin: string;
  fetch?: typeof globalThis.fetch;
}

export class OidcRouteError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "OidcRouteError";
  }
}

/** Timing-safe comparison of the BFF shared secret. */
function assertBffSecret(supplied: string | undefined, expected: string): void {
  if (supplied === undefined)
    throw new OidcRouteError("UNAUTHORIZED", "Missing BFF secret.", 401);
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new OidcRouteError("UNAUTHORIZED", "Invalid BFF secret.", 401);
  }
}

function notConfigured(): never {
  throw new OidcRouteError(
    "AUTH_NOT_CONFIGURED",
    getAuthErrorMessage("AUTH_NOT_CONFIGURED"),
    503,
  );
}

const BROWSER_BINDING_SCHEMA = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export function registerOidcLoginRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  deps: OidcLoginDependencies,
): void {
  const cipher = createFlowCipher(deps.flowEncryptionKey);
  const attemptStore = createOidcAttemptStore(deps.sql, cipher);
  const identityRepo = createVerifiedIdentityRepository(deps.sql);
  const sessionManager = createSessionManager(deps.sql);

  // POST /v1/auth/oidc/google/start
  // BFF requests a new OIDC attempt. Returns ONLY the Google authorization URL.
  // The BFF generates the browserBindingSecret and sets the cookie; the API
  // never regenerates or returns it.
  app.post("/v1/auth/oidc/google/start", async (context) => {
    assertBffSecret(context.req.header("x-bff-secret"), deps.bffSharedSecret);
    if (
      deps.googleClientId === undefined ||
      deps.googleClientSecret === undefined ||
      deps.googleRedirectUri === undefined
    ) {
      notConfigured();
    }

    const body = (await context.req.json().catch(() => ({}))) as {
      redirectPath?: string;
      browserBindingSecret?: string;
    };

    // Validate redirectPath using the shared canonicalization module.
    let redirectPath: string;
    try {
      const rawPath =
        typeof body.redirectPath === "string" ? body.redirectPath : "/";
      redirectPath = normalizePostLoginRedirect(rawPath, deps.webOrigin);
    } catch (error: unknown) {
      if (error instanceof RedirectValidationError) {
        throw new OidcRouteError(
          "INVALID_REDIRECT_PATH",
          getAuthErrorMessage("INVALID_REDIRECT_PATH"),
          400,
        );
      }
      throw error;
    }

    // browserBindingSecret is REQUIRED — the BFF must generate and provide it.
    // The API must NOT regenerate it or return it.
    const bindingResult = BROWSER_BINDING_SCHEMA.safeParse(
      body.browserBindingSecret,
    );
    if (!bindingResult.success) {
      throw new OidcRouteError(
        "AUTH_BROWSER_BINDING_INVALID",
        getAuthErrorMessage("AUTH_BROWSER_BINDING_INVALID"),
        400,
      );
    }
    const browserBindingSecret = bindingResult.data;
    const browserBindingHash = createHash("sha256")
      .update(browserBindingSecret, "utf8")
      .digest();

    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256")
      .update(codeVerifier, "utf8")
      .digest("base64url");

    await attemptStore.create({
      provider: "google",
      flowType: "login",
      state,
      nonce,
      codeVerifier,
      redirectPath,
      browserBindingHash,
      ttlMs: ATTEMPT_TTL_MS,
    });

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", deps.googleClientId);
    url.searchParams.set("redirect_uri", deps.googleRedirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", LOGIN_SCOPES.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("access_type", "online");
    url.searchParams.set("prompt", "consent");

    // Response returns ONLY the authorization URL.
    // browserBindingSecret is NOT returned — the BFF already has it.
    return context.json({ authorizationUrl: url.toString() });
  });

  // POST /v1/auth/oidc/google/callback
  // BFF posts the Google callback (code + state + browserBindingSecret).
  // The API exchanges the code, verifies the ID token, links the verified
  // identity, creates a session, and returns the session token (server-to-server only).
  const callbackSchema = z
    .object({
      code: z.string().min(1),
      state: z.string().min(1),
      browserBindingSecret: z.string().min(1),
    })
    .strict();

  // Precise HTTP mapping for OidcAttemptError codes.
  const ATTEMPT_ERROR_STATUS: Record<string, number> = {
    AUTH_STATE_INVALID: 400,
    AUTH_FLOW_EXPIRED: 400,
    AUTH_FLOW_REPLAYED: 409,
    AUTH_BROWSER_BINDING_INVALID: 400,
  };

  app.post("/v1/auth/oidc/google/callback", async (context) => {
    assertBffSecret(context.req.header("x-bff-secret"), deps.bffSharedSecret);
    if (
      deps.googleClientId === undefined ||
      deps.googleClientSecret === undefined ||
      deps.googleRedirectUri === undefined
    ) {
      notConfigured();
    }

    const input = callbackSchema.parse(await context.req.json());

    // Consume the attempt (one-time, replay-safe).
    // Preserve precise error codes — do NOT collapse to AUTH_FLOW_INVALID.
    let consumed;
    try {
      consumed = await attemptStore.consume(
        input.state,
        input.browserBindingSecret,
      );
    } catch (error: unknown) {
      if (error instanceof OidcAttemptError) {
        const status = ATTEMPT_ERROR_STATUS[error.code] ?? 400;
        throw new OidcRouteError(
          error.code,
          getAuthErrorMessage(error.code),
          status,
        );
      }
      throw new OidcRouteError(
        "AUTH_FLOW_INVALID",
        getAuthErrorMessage("AUTH_FLOW_INVALID"),
        400,
      );
    }

    // Exchange the authorization code for tokens.
    const fetcher = deps.fetch ?? globalThis.fetch;
    const tokenResponse = await fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: input.code,
        client_id: deps.googleClientId,
        client_secret: deps.googleClientSecret,
        redirect_uri: deps.googleRedirectUri,
        grant_type: "authorization_code",
        code_verifier: consumed.codeVerifier,
      }),
    });
    if (!tokenResponse.ok) {
      await attemptStore.markFailed(input.state, "TOKEN_EXCHANGE_FAILED");
      throw new OidcRouteError(
        "AUTH_TOKEN_EXCHANGE_FAILED",
        getAuthErrorMessage("AUTH_TOKEN_EXCHANGE_FAILED"),
        502,
      );
    }
    const tokens = (await tokenResponse.json()) as { id_token?: string };
    if (tokens.id_token === undefined) {
      throw new OidcRouteError(
        "AUTH_TOKEN_EXCHANGE_FAILED",
        getAuthErrorMessage("AUTH_TOKEN_EXCHANGE_FAILED"),
        502,
      );
    }

    // Verify the ID token (signature + all claims).
    let verified;
    try {
      verified = await verifyGoogleLoginIdToken({
        idToken: tokens.id_token,
        clientId: deps.googleClientId,
        expectedNonce: consumed.nonce,
      });
    } catch (error: unknown) {
      if (error instanceof OidcLoginError) {
        await attemptStore.markFailed(input.state, error.code);
        throw new OidcRouteError(
          error.code,
          getAuthErrorMessage(error.code),
          400,
        );
      }
      throw error;
    }

    // Authorization: allowlist checked AFTER identity verification.
    const normalizedEmail = verified.email.trim().toLowerCase();
    if (
      deps.signupMode === "allowlist" &&
      !deps.allowlistEmails.has(normalizedEmail)
    ) {
      await attemptStore.markFailed(input.state, "AUTH_ACCOUNT_NOT_ALLOWED");
      throw new OidcRouteError(
        "AUTH_ACCOUNT_NOT_ALLOWED",
        getAuthErrorMessage("AUTH_ACCOUNT_NOT_ALLOWED"),
        403,
      );
    }

    // Link the verified identity to a user.
    const linked = await identityRepo.link({
      provider: "google",
      providerSubject: verified.subject,
      verifiedEmail: normalizedEmail,
      emailVerified: true,
      now: new Date(),
    });

    // Create a hardened session using DB-authoritative time.
    const session = await sessionManager.createWithDbClock({
      userId: linked.userId,
      authMethod: "oidc:google",
      idleTtlMs: deps.idleTtlMs,
      absoluteTtlMs: deps.absoluteTtlMs,
    });

    return context.json(
      {
        token: session.token,
        sessionId: session.sessionId,
        expiresAt: session.expiresAt,
        idleExpiresAt: session.idleExpiresAt,
        absoluteExpiresAt: session.absoluteExpiresAt,
        cookieMaxAgeSeconds: session.cookieMaxAgeSeconds,
        redirectPath: consumed.redirectPath,
        user: { id: linked.userId, email: verified.email },
      },
      201,
    );
  });
}
