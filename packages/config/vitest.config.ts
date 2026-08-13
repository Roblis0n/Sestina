import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "config",
    include: ["test/**/*.test.ts"],
    coverage: {
      include: ["src/**/*.ts"],
    },
  },
});
