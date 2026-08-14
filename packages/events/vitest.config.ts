import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "events",
    include: ["test/**/*.test.ts"],
    coverage: {
      include: ["src/**/*.ts"],
    },
  },
});
