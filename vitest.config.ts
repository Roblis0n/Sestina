import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Keep all projects and assertions, but make the repository-wide Windows
    // gate deterministic for SQLite/file-lock heavy suites.
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
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
