import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    globalSetup: ["./test/global-postgres.ts"],
    setupFiles: ["./test/setup.ts"],
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
