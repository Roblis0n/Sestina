import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/e2e/host/codex/codex-real.test.ts"],
    sequence: { concurrent: false },
  },
});
