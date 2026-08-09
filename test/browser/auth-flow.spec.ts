import { expect, test } from "@playwright/test";

/**
 * Browser E2E test for the authentication flow.
 *
 * Verifies:
 * 1. Login page renders correctly
 * 2. Form validation works (empty email rejected)
 * 3. Non-allowlist email shows error
 * 4. Allowlist email sets HttpOnly cookie and redirects to /new/threads
 * 5. Cookie is HttpOnly (not accessible from JS)
 * 6. Logout clears cookie and redirects to login
 *
 * Prerequisites:
 * - API server running at E2E_API_URL (default http://localhost:3000)
 * - ACCESS_ALLOWLIST_EMAILS includes the test email
 * - Next.js dev server running (started by CI or playwright.config.ts)
 */

const TEST_EMAIL = process.env.E2E_TEST_EMAIL ?? "e2e-browser@test.local";

test.describe("authentication flow", () => {
  test("login page renders with email input and submit button", async ({
    page,
  }) => {
    await page.goto("/new/login");
    await expect(page.locator("h1")).toHaveText("Town");
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toHaveText("Sign in");
  });

  test("empty email is rejected by browser validation", async ({ page }) => {
    await page.goto("/new/login");
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/new\/login/);
  });

  test("non-allowlist email shows access denied error", async ({ page }) => {
    await page.goto("/new/login");
    await page.locator('input[type="email"]').fill("notallowed@example.com");
    await page.locator('button[type="submit"]').click();
    const alert = page.locator('p[role="alert"]');
    await expect(alert).toBeVisible({ timeout: 15000 });
    await expect(alert).toContainText(/allowlist|not allowed|forbidden/i);
    await expect(page).toHaveURL(/\/new\/login/);
  });

  test("allowlist email logs in and redirects to threads", async ({ page }) => {
    await page.goto("/new/login");
    await page.locator('input[type="email"]').fill(TEST_EMAIL);
    await page.locator('button[type="submit"]').click();

    // Wait for either redirect or error
    await Promise.race([
      expect(page).toHaveURL(/\/new\/threads/, { timeout: 30000 }),
      expect(page.locator('p[role="alert"]')).toBeVisible({ timeout: 30000 }),
    ]);

    // If we're still on login, there was an error
    const currentUrl = page.url();
    if (currentUrl.includes("/new/login")) {
      const errorText = await page.locator('p[role="alert"]').textContent();
      throw new Error(
        `Login failed. Error shown: ${errorText ?? "unknown error"}`,
      );
    }
  });

  test("session token cookie is HttpOnly (not readable by JS)", async ({
    page,
    context,
  }) => {
    await page.goto("/new/login");
    await page.locator('input[type="email"]').fill(TEST_EMAIL);
    await page.locator('button[type="submit"]').click();

    await Promise.race([
      expect(page).toHaveURL(/\/new\/threads/, { timeout: 30000 }),
      expect(page.locator('p[role="alert"]')).toBeVisible({ timeout: 30000 }),
    ]);

    if (page.url().includes("/new/login")) {
      throw new Error("Login failed, cannot verify HttpOnly cookie");
    }

    const cookies = await context.cookies();
    const tokenCookie = cookies.find((c) => c.name === "town-token");
    expect(tokenCookie).toBeDefined();
    expect(tokenCookie?.httpOnly).toBe(true);
    expect(tokenCookie?.sameSite).toBe("Lax");

    const jsCookieAccess = await page.evaluate(() => document.cookie);
    expect(jsCookieAccess).not.toContain("town-token");
  });

  test("logout clears session and redirects to login", async ({ page }) => {
    await page.goto("/new/login");
    await page.locator('input[type="email"]').fill(TEST_EMAIL);
    await page.locator('button[type="submit"]').click();

    await Promise.race([
      expect(page).toHaveURL(/\/new\/threads/, { timeout: 30000 }),
      expect(page.locator('p[role="alert"]')).toBeVisible({ timeout: 30000 }),
    ]);

    if (page.url().includes("/new/login")) {
      throw new Error("Login failed, cannot test logout");
    }

    // Wait for the app layout to finish loading (sidebar renders after
    // /api/auth/me confirms the session). The layout shows "Loading…" while
    // waiting, then either renders the sidebar or redirects to /new/login.
    await expect(page.locator("button", { hasText: "Sign out" })).toBeVisible({
      timeout: 30000,
    });
    await page.locator("button", { hasText: "Sign out" }).click();
    await expect(page).toHaveURL(/\/new\/login/, { timeout: 15000 });

    const cookies = await page.context().cookies();
    const tokenCookie = cookies.find((c) => c.name === "town-token");
    // Cookie is cleared on logout — either removed entirely (maxAge=0)
    // or set to an empty string depending on the browser.
    expect(tokenCookie?.value ?? "").toBe("");
  });
});
