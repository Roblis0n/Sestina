import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/e2e/host/codex/ri40-local.test.ts",
      "tests/e2e/capsule-roundtrip/ri40-capsule-local.test.ts",
    ],
    sequence: { concurrent: false },
  },
});
