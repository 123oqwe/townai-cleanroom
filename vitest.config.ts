import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    exclude: ["**/node_modules/**", "**/dist/**", "test/e2e/**"],
    globalSetup: ["./test/global-postgres.ts"],
    setupFiles: ["./test/setup.ts"],
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
