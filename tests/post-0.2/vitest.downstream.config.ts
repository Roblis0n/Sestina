import { defineConfig } from "vitest/config";
import { aliases } from "./aliases.js";

// Intentionally RED target contracts. This command exits nonzero until the
// corresponding later gates implement the accepted product behavior.
export default defineConfig({ resolve: { alias: aliases }, test: {
  include: ["tests/post-0.2/downstream/**/*.test.ts"],
  fileParallelism: false, maxWorkers: 1, testTimeout: 30_000,
} });
