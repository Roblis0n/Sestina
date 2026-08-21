import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/e2e/pilot-local/**/*.test.ts"],
    maxWorkers: 1,
    minWorkers: 1,
  },
});
