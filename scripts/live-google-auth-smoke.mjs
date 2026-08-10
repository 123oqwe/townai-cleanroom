#!/usr/bin/env node
// Phase 01A: Google Live Auth Smoke Test.
//
// This script performs a REAL end-to-end Google OIDC login against a staging
// deployment to verify the authentication flow works with real Google
// credentials. It is NOT a mock. It requires real AUTH_GOOGLE_* credentials.
//
// STATUS: BLOCKED_BY_CREDENTIAL
// Real Google credentials are not available in this environment. The full
// code path is implemented and unit/integration-tested locally, but Live
// Verification (S4) cannot be performed without:
//   - A Google Cloud project with OAuth 2.0 credentials configured
//   - AUTH_GOOGLE_CLIENT_ID / AUTH_GOOGLE_CLIENT_SECRET / AUTH_GOOGLE_REDIRECT_URI
//   - A staging deployment reachable from Google's callback
//   - A real test Google account that completes consent
//
// Until this smoke test passes against real Google, the Public Beta Gate
// remains NO-GO. Do not mark GOOGLE_LIVE_VERIFIED.

const REQUIRED = [
  "AUTH_GOOGLE_CLIENT_ID",
  "AUTH_GOOGLE_CLIENT_SECRET",
  "AUTH_GOOGLE_REDIRECT_URI",
  "AUTH_BFF_SHARED_SECRET",
  "AUTH_FLOW_ENCRYPTION_KEY_BASE64URL",
  "STAGING_API_URL",
  "STAGING_WEB_URL",
  "GOOGLE_TEST_ACCOUNT_EMAIL",
];

function missing() {
  return REQUIRED.filter((name) => !process.env[name]);
}

async function main() {
  const absent = missing();
  if (absent.length > 0) {
    console.error("BLOCKED_BY_CREDENTIAL");
    console.error("Missing required environment variables:");
    for (const name of absent) console.error(`  - ${name}`);
    console.error("");
    console.error("Required Google Console configuration:");
    console.error("  1. Create a Google Cloud project (or use existing).");
    console.error("  2. Enable Google+ API / OpenID Connect.");
    console.error("  3. Create OAuth 2.0 Client ID (Web application).");
    console.error("  4. Add the authorized redirect URI:");
    console.error("     ${AUTH_GOOGLE_REDIRECT_URI}");
    console.error("  5. Configure all AUTH_* env vars in staging.");
    console.error("  6. Use a real test Google account for consent.");
    console.error("");
    console.error("Public Beta Gate: NO-GO (BLOCKED_BY_CREDENTIAL)");
    process.exit(2);
  }

  // When credentials are present, this script would:
  // 1. POST ${STAGING_API_URL}/v1/auth/oidc/google/start (BFF secret)
  // 2. Open the authorization URL in a headless browser (Playwright)
  // 3. Complete real Google login + consent with GOOGLE_TEST_ACCOUNT_*
  // 4. Follow the callback redirect to the BFF
  // 5. Assert the session cookie is HttpOnly and not readable by JS
  // 6. Assert /api/auth/me returns the verified user
  // 7. Logout and assert the session is server-side revoked
  // 8. Replay the callback and assert it is rejected
  //
  // This requires a headed/headless browser with real Google credentials,
  // which is out of scope for an unattended CI run. It must be executed
  // manually in a staging environment.
  console.log("Credentials present. Run this script manually in staging");
  console.log("with a real browser to complete Live Verification.");
  console.log(
    "See docs/evidence/phase-01a-production-auth.md for the checklist.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
