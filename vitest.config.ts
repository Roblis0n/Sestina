import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const fixtureResolution = {
  conditions: ["sestina-legacy-fixtures"],
  alias: { "@sestina/core": resolve("packages/core/test/fixture-entry.ts") },
};

export default defineConfig({
  resolve: { conditions: ["sestina-legacy-fixtures"] },
  test: {
    // Keep all projects and assertions, but make the repository-wide Windows
    // gate deterministic for SQLite/file-lock heavy suites.
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    projects: [
      {
        resolve: fixtureResolution,
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
        resolve: fixtureResolution,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
        },
      },
      {
        resolve: fixtureResolution,
        test: {
          name: "ipc",
          include: ["tests/ipc/**/*.test.ts"],
        },
      },
      {
        resolve: fixtureResolution,
        test: {
          name: "desktop",
          include: ["tests/desktop/**/*.test.ts"],
        },
      },
    ],
  },
});
