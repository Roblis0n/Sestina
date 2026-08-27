import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

export default defineConfig({
  testDir: ".",
  testMatch: "ui03-browser.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 12_000 },
  reporter: "line",
  use: {
    headless: true,
    locale: "zh-CN",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    launchOptions: existsSync(edge) ? { executablePath: edge } : undefined,
  },
  outputDir: join(tmpdir(), "sestina-ui03-playwright"),
});
