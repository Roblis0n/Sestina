import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defineConfig } from "@playwright/test";
const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
export default defineConfig({ testDir: "./downstream", testMatch: "*.spec.ts", workers: 1, retries: 0, timeout: 45000, expect: { timeout: 5000 }, reporter: "line", outputDir: join(tmpdir(), "sestina-g1-downstream-ui"), use: { headless: true, viewport: { width: 1280, height: 900 }, trace: "retain-on-failure", launchOptions: existsSync(edge) ? { executablePath: edge } : undefined } });
