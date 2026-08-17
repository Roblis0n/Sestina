import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "evidence",
    include: ["test/**/*.test.ts"],
    coverage: {
      include: ["src/**/*.ts"],
    },
  },
});
