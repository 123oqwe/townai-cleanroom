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
} from "@town/identity";

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
    "Google OIDC login is not configured.",
    503,
  );
}

export function registerOidcLoginRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  deps: OidcLoginDependencies,
): void {
  const cipher = createFlowCipher(deps.flowEncryptionKey);
  const attemptStore = createOidcAttemptStore(deps.sql, cipher);
  const identityRepo = createVerifiedIdentityRepository(deps.sql);
  const sessionManager = createSessionManager(deps.sql);

  // POST /v1/auth/oidc/google/start
  // BFF requests a new OIDC attempt. Returns the Google authorization URL
  // + state + nonce for the BFF to redirect the browser to.
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
    };
    const redirectPath =
      typeof body.redirectPath === "string" &&
      body.redirectPath.startsWith("/") &&
      !body.redirectPath.startsWith("//")
        ? body.redirectPath
        : "/";

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

    return context.json({ authorizationUrl: url.toString(), state, nonce });
  });

  // POST /v1/auth/oidc/google/callback
  // BFF posts the Google callback (code + state). The API exchanges the code,
  // verifies the ID token, links the verified identity, creates a session,
  // and returns the session token (server-to-server only -- never to browser).
  const callbackSchema = z
    .object({
      code: z.string().min(1),
      state: z.string().min(1),
    })
    .strict();

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
    let consumed;
    try {
      consumed = await attemptStore.consume(input.state);
    } catch (error: unknown) {
      const code = error instanceof Error ? error.message : "AUTH_FLOW_INVALID";
      throw new OidcRouteError("AUTH_FLOW_INVALID", code, 400);
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
        "Token exchange failed.",
        502,
      );
    }
    const tokens = (await tokenResponse.json()) as { id_token?: string };
    if (tokens.id_token === undefined) {
      throw new OidcRouteError(
        "AUTH_TOKEN_EXCHANGE_FAILED",
        "No ID token returned.",
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
        throw new OidcRouteError(error.code, error.message, 400);
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
        "This account is not allowed.",
        403,
      );
    }

    // Link the verified identity to a user.
    const now = new Date();
    const linked = await identityRepo.link({
      provider: "google",
      providerSubject: verified.subject,
      verifiedEmail: verified.email,
      emailVerified: true,
      now,
    });

    // Create a hardened session.
    const session = await sessionManager.create({
      userId: linked.userId,
      authMethod: "oidc:google",
      now,
      idleTtlMs: deps.idleTtlMs,
      absoluteTtlMs: deps.absoluteTtlMs,
    });

    const cookieMaxAgeSeconds = Math.floor(
      (session.absoluteExpiresAt.getTime() - now.getTime()) / 1000,
    );
    return context.json(
      {
        token: session.token,
        sessionId: session.sessionId,
        expiresAt: session.expiresAt,
        idleExpiresAt: session.idleExpiresAt,
        absoluteExpiresAt: session.absoluteExpiresAt,
        cookieMaxAgeSeconds,
        redirectPath: consumed.redirectPath,
        user: { id: linked.userId, email: verified.email },
      },
      201,
    );
  });
}
