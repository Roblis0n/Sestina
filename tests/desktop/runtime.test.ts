import { it, expect } from "vitest";
import { spawnSync } from "node:child_process";
it("starts real Electron main and verifies its SQLite/Core/credential runtime", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/verify-desktop-runtime.mjs"],
    { encoding: "utf8", timeout: 120000, windowsHide: true },
  );
  expect(result.status, result.stderr).toBe(0);
  const report = JSON.parse(result.stdout);
  expect(report.passed).toBe(true);
  expect(report.processType).toBe("browser");
  expect(report.versions.electron).toBe("44.3.0");
  expect(report.sqliteTransactionReopen).toBe(true);
  expect(report.kernelDraftReopen).toBe(true);
  if (process.platform === "win32")
    expect(report.legacyCredentialMigration).toBe(true);
}, 120000);
