import { defineConfig } from "vitest/config";
import { aliases } from "./aliases.js";

export default defineConfig({ resolve: { alias: aliases }, test: {
  include: ["tests/post-0.2/foundation/**/*.test.ts"],
  fileParallelism: false, maxWorkers: 1, testTimeout: 60_000, hookTimeout: 60_000,
} });
