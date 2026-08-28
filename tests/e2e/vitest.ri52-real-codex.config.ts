import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/e2e/host/codex/ri52-real-codex.test.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 420_000,
    hookTimeout: 30_000,
  },
});
