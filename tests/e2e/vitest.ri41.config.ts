import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/e2e/recovery/ri41-recovery.test.ts"],
    sequence: { concurrent: false },
    testTimeout: 30_000,
  },
});
