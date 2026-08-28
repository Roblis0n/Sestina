import { defineConfig } from "vitest/config";

process.env.SESTINA_RI52_REAL_CODEX_CONTINUITY = "authorized_once";

export default defineConfig({
  test: {
    include: ["tests/e2e/host/codex/ri52-continuity-only.test.ts"],
    fileParallelism: false,
    retry: 0,
    sequence: { concurrent: false },
    testTimeout: 420_000,
    hookTimeout: 30_000,
  },
});
