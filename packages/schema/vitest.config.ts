import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "schema",
    include: ["test/**/*.test.ts"],
    coverage: {
      include: ["src/**/*.ts"],
    },
  },
});
