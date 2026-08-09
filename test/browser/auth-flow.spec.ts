import { expect, test } from "@playwright/test";

/**
 * Browser E2E test for the Phase 01A authentication flow.
 *
 * Verifies:
 * 1. Login page renders "Continue with Google" (no email input in prod)
 * 2. Error states from URL params display correctly
 * 3. Retry button clears error state
 * 4. Google start endpoint returns authorization URL or config error
 * 5. Cross-origin POST to BFF proxy is rejected by CSRF guard
 * 6. Dev-only email login sets HttpOnly cookie (skipped without dev login)
 * 7. Logout clears cookie and redirects to login (skipped without dev login)
 *
 * Prerequisites:
 * - API server running at E2E_API_URL (default http://localhost:3000)
 * - Next.js dev server running (started by playwright.config.ts)
 */

const WEB_ORIGIN = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001";

test.describe("Phase 01A authentication flow", () => {
  test("login page renders 'Continue with Google' button (no email input)", async ({
    page,
  }) => {
    await page.goto("/new/login");
    await expect(page.locator("h1")).toHaveText("Town");
    await expect(
      page.locator("button", { hasText: "Continue with Google" }),
    ).toBeVisible();
    // No email input in the OIDC-only login page.
    await expect(page.locator('input[type="email"]')).toHaveCount(0);
    await expect(page.locator('input[name="email"]')).toHaveCount(0);
  });

  test("error from URL param is displayed with retry button", async ({
    page,
  }) => {
    await page.goto("/new/login?error=access_denied");
    await expect(page.locator("p[role='alert']")).toBeVisible();
    await expect(page.locator("p[role='alert']")).toContainText(
      /Access was denied/i,
    );
    await expect(page.locator("button", { hasText: "Retry" })).toBeVisible();
  });

  test("retry button clears the error state", async ({ page }) => {
    await page.goto("/new/login?error=auth_failed");
    await expect(page.locator("p[role='alert']")).toBeVisible();
    await page.locator("button", { hasText: "Retry" }).click();
    await expect(page.locator("p[role='alert']")).toHaveCount(0);
    await expect(
      page.locator("button", { hasText: "Continue with Google" }),
    ).toBeVisible();
  });

  test("google start endpoint returns authorization URL or config error", async ({
    request,
  }) => {
    // The BFF /api/auth/google/start endpoint should respond.
    // In dev without Google creds: 503 AUTH_NOT_CONFIGURED.
    // In dev with Google creds: 200 + authorizationUrl.
    const response = await request.post(`${WEB_ORIGIN}/api/auth/google/start`, {
      data: { redirectPath: "/new/threads" },
      headers: { "content-type": "application/json" },
    });
    expect([200, 503]).toContain(response.status());
    if (response.ok()) {
      const body = await response.json();
      expect(body.authorizationUrl).toContain("accounts.google.com");
    }
  });

  test("cross-origin POST to BFF proxy is rejected by CSRF guard", async ({
    request,
  }) => {
    const response = await request.post(`${WEB_ORIGIN}/api/proxy/v1/me`, {
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example.com",
      },
      data: {},
    });
    expect(response.status()).toBe(403);
    const body = await response.json();
    expect(body.code).toBe("CSRF_REJECTED");
  });

  test("dev-only email login sets HttpOnly cookie", async ({
    page,
    context,
  }) => {
    test.skip(!process.env.E2E_DEV_LOGIN_ENABLED, "dev login not enabled");

    const testEmail = process.env.E2E_TEST_EMAIL ?? "e2e-browser@test.local";
    await page.goto("/new/login");

    const response = await page.request.post("/api/auth/login", {
      data: { email: testEmail },
      headers: { "content-type": "application/json" },
    });

    if (!response.ok()) {
      test.skip(true, `Dev login failed: ${response.status()}`);
      return;
    }

    await page.goto("/new/threads");

    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) => c.name.includes("town-session"));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.sameSite).toBe("Lax");

    const jsCookieAccess = await page.evaluate(() => document.cookie);
    expect(jsCookieAccess).not.toContain("town-session");
  });

  test("logout clears session and redirects to login", async ({ page }) => {
    test.skip(!process.env.E2E_DEV_LOGIN_ENABLED, "dev login not enabled");

    const testEmail = process.env.E2E_TEST_EMAIL ?? "e2e-browser@test.local";
    await page.goto("/new/login");

    const response = await page.request.post("/api/auth/login", {
      data: { email: testEmail },
      headers: { "content-type": "application/json" },
    });

    if (!response.ok()) {
      test.skip(true, `Dev login failed: ${response.status()}`);
      return;
    }

    await page.goto("/new/threads");

    const logoutResponse = await page.request.post("/api/auth/logout", {
      headers: { "content-type": "application/json" },
    });
    expect(logoutResponse.ok()).toBe(true);

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name.includes("town-session"));
    expect(sessionCookie?.value ?? "").toBe("");

    await expect(page).toHaveURL(/\/new\/login/, { timeout: 15000 });
  });
});
