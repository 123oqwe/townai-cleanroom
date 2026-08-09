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
 * - ACCESS_ALLOWLIST_EMAILS includes "e2e-browser@test.local"
 * - Next.js dev server running (started by playwright.config.ts webServer)
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
    // Browser's built-in required validation should prevent submission
    // The page should still be on /new/login
    await expect(page).toHaveURL(/\/new\/login/);
  });

  test("non-allowlist email shows access denied error", async ({ page }) => {
    await page.goto("/new/login");
    await page.locator('input[type="email"]').fill("notallowed@example.com");
    await page.locator('button[type="submit"]').click();
    // Wait for error message to appear
    const alert = page.locator('p[role="alert"]');
    await expect(alert).toBeVisible({
      timeout: 15000,
    });
    await expect(alert).toContainText(/allowlist|not allowed|forbidden/i);
    // Should still be on login page
    await expect(page).toHaveURL(/\/new\/login/);
  });

  test("allowlist email logs in and redirects to threads", async ({ page }) => {
    await page.goto("/new/login");
    await page.locator('input[type="email"]').fill(TEST_EMAIL);
    await page.locator('button[type="submit"]').click();
    // Should redirect to /new/threads
    await expect(page).toHaveURL(/\/new\/threads/, { timeout: 15000 });
  });

  test("session token cookie is HttpOnly (not readable by JS)", async ({
    page,
    context,
  }) => {
    // First log in
    await page.goto("/new/login");
    await page.locator('input[type="email"]').fill(TEST_EMAIL);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/new\/threads/, { timeout: 15000 });

    // Check that the cookie exists and is HttpOnly
    const cookies = await context.cookies();
    const tokenCookie = cookies.find((c) => c.name === "town-token");
    expect(tokenCookie).toBeDefined();
    expect(tokenCookie?.httpOnly).toBe(true);
    expect(tokenCookie?.sameSite).toBe("Lax");

    // Verify JS cannot read the cookie (HttpOnly)
    const jsCookieAccess = await page.evaluate(() => {
      return document.cookie;
    });
    expect(jsCookieAccess).not.toContain("town-token");
  });

  test("logout clears session and redirects to login", async ({ page }) => {
    // First log in
    await page.goto("/new/login");
    await page.locator('input[type="email"]').fill(TEST_EMAIL);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/new\/threads/, { timeout: 15000 });

    // Click sign out button
    await page.locator("button", { hasText: "Sign out" }).click();
    // Should redirect to /new/login
    await expect(page).toHaveURL(/\/new\/login/, { timeout: 15000 });

    // Cookie should be cleared
    const cookies = await page.context().cookies();
    const tokenCookie = cookies.find((c) => c.name === "town-token");
    expect(tokenCookie?.value).toBe("");
  });
});
