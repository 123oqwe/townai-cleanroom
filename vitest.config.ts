import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "apps/web-next/"),
    },
  },
  test: {
    fileParallelism: false,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "test/e2e/**",
      "test/browser/**",
    ],
    globalSetup: ["./test/global-postgres.ts"],
    setupFiles: ["./test/setup.ts"],
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
