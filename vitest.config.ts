import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";

// Dynamically discover existing project directories
const projectDirs: string[] = [];

const packageNames = ["schema", "config", "secrets", "storage", "events", "projects",
  "contracts", "evidence", "policy", "providers", "conversations", "reviews",
  "observability", "core", "eval"];

for (const name of packageNames) {
  if (existsSync(`packages/${name}`)) projectDirs.push(`packages/${name}`);
}

const appNames = ["background-runtime", "desktop", "hook-runner", "mcp-server", "cli"];
for (const name of appNames) {
  if (existsSync(`apps/${name}`)) projectDirs.push(`apps/${name}`);
}

const testDirs = ["integration", "ipc", "desktop", "e2e", "eval", "security", "performance"];
for (const name of testDirs) {
  if (existsSync(`tests/${name}`)) projectDirs.push(`tests/${name}`);
}

export default defineConfig({
  test: {
    projects: projectDirs,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      include: ["packages/*/src/**", "apps/*/src/**"],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/test/**",
        "**/tests/**",
        "**/*.config.*",
        "**/index.ts",
      ],
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    sequence: {
      shuffle: true,
    },
  },
});
