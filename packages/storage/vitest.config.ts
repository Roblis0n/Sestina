import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "storage",
    include: ["test/**/*.test.ts"],
    coverage: {
      include: ["src/**/*.ts"],
    },
    testTimeout: 30000,
  },
});
