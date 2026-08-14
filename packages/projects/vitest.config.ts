import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "projects",
    include: ["test/**/*.test.ts"],
    coverage: {
      include: ["src/**/*.ts"],
    },
  },
});
