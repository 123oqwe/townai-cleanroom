import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for browser E2E tests.
 *
 * These tests run separately from `pnpm verify` (too slow for local dev).
 * CI runs them in a dedicated job. The test setup script starts both the
 * API server (with testcontainers PostgreSQL) and the Next.js dev server.
 *
 * Prerequisites:
 * - PostgreSQL available via DATABASE_URL or testcontainers
 * - API built (pnpm --filter @town/api build)
 * - @town/web-client built (pnpm --filter @town/web-client build)
 *
 * Run locally:
 *   pnpm test:e2e:browser
 */
export default defineConfig({
  testDir: "./test/browser",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: process.env.E2E_WEB_URL ?? "http://localhost:3001",
    trace: "on-first-retry",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.E2E_SKIP_WEB_SERVER
    ? undefined
    : {
        command:
          "pnpm --filter @town/web-client build && pnpm --filter @town/web-next dev --port 3001",
        url: "http://localhost:3001/new/login",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          NEXT_PUBLIC_API_BASE_URL:
            process.env.E2E_API_URL ?? "http://localhost:3000",
        },
      },
});
