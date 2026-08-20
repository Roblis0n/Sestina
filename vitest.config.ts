import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: [
            "packages/*/test/**/*.test.ts",
            "apps/*/test/**/*.test.ts",
            "integrations/*/test/**/*.test.ts",
            "spikes/*/test/**/*.test.ts",
            "tests/repository/**/*.test.ts",
          ],
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "ipc",
          include: ["tests/ipc/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "desktop",
          include: ["tests/desktop/**/*.test.ts"],
        },
      },
    ],
  },
});
