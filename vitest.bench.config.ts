import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// ── Standalone benchmark config (docs/22 Task 6 Step 5) ──
// Run with: pnpm exec vitest bench --run --config vitest.bench.config.ts
// Kept out of the main vitest.config.ts so regular test runs never load
// the 100k-seed benchmark suite.
export default defineConfig({
  test: {
    name: "bench",
    include: ["tests/performance/**/*.bench.ts"],
    hookTimeout: 600_000,
    testTimeout: 600_000,
  },
  resolve: {
    alias: {
      // Performance tests live outside any package and resolve workspace
      // packages through these aliases.
      "@sestina/schema": resolve(__dirname, "packages/schema/src/index.ts"),
      "@sestina/storage": resolve(__dirname, "packages/storage/src/index.ts"),
    },
  },
});
