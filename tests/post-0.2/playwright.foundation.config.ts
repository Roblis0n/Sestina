import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defineConfig } from "@playwright/test";
const edge =
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
export default defineConfig({
  tsconfig: "./tsconfig.ui.json",
  testDir: "./foundation",
  testMatch: "*.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 5000 },
  reporter: "line",
  outputDir: join(tmpdir(), "sestina-kernel-ui"),
  use: {
    headless: true,
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
    launchOptions: existsSync(edge) ? { executablePath: edge } : undefined,
  },
});
