import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

export default defineConfig({
  testDir: ".",
  testMatch: "ri48-browser.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: "line",
  use: {
    headless: true,
    locale: "zh-CN",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    launchOptions: existsSync(edge) ? { executablePath: edge } : undefined,
  },
  outputDir: "../../test-results/ri48-playwright",
});
