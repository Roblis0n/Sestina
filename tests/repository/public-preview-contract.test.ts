import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(root, path), "utf8")) as Record<
    string,
    unknown
  >;
}

describe("RI-54 public preview repository contract", () => {
  it("publishes the project under Apache-2.0 without enabling npm publication", () => {
    const license = readFileSync(resolve(root, "LICENSE"), "utf8");
    expect(license).toContain("Apache License");
    expect(license).toContain("Version 2.0, January 2004");

    for (const path of [
      "apps/research-room/package.json",
      "apps/cli/package.json",
    ]) {
      const manifest = json(path);
      expect(manifest.license).toBe("Apache-2.0");
      expect(manifest.private).toBe(true);
      expect(manifest.version).toBe("0.2.0");
    }
  });

  it("ships a privacy-safe public support surface", () => {
    for (const path of [
      "SECURITY.md",
      "SUPPORT.md",
      ".github/ISSUE_TEMPLATE/bug-report.yml",
      "docs/release/RELEASE-NOTES-0.2.0.md",
    ]) {
      expect(readFileSync(resolve(root, path), "utf8").length).toBeGreaterThan(100);
    }
    const template = readFileSync(
      resolve(root, ".github/ISSUE_TEMPLATE/bug-report.yml"),
      "utf8",
    );
    for (const warning of [
      "research content",
      "secret",
      "project path",
      "raw logs",
    ]) {
      expect(template.toLowerCase()).toContain(warning);
    }
  });

  it("pins the exact public-preview platform matrix and deterministic release assembly", () => {
    const workflow = readFileSync(
      resolve(root, ".github/workflows/ci.yml"),
      "utf8",
    );
    for (const expected of [
      "windows-2025",
      "expected-os: win32",
      "expected-arch: x64",
      "macos-15",
      "expected-os: darwin",
      "expected-arch: arm64",
      "ubuntu-24.04",
      "expected-os: linux",
      "pnpm verify:ri54 ${{ matrix.expected-os }} ${{ matrix.expected-arch }}",
    ]) {
      expect(workflow).toContain(expected);
    }
    for (const path of [
      "scripts/assemble-public-release.mjs",
      "scripts/verify-public-release.mjs",
      "scripts/package-pilot-kit.mjs",
      "scripts/audit-public-history.mjs",
    ]) {
      expect(readFileSync(resolve(root, path), "utf8").length).toBeGreaterThan(
        300,
      );
    }

    const historyAudit = readFileSync(
      resolve(root, "scripts/audit-public-history.mjs"),
      "utf8",
    );
    expect(historyAudit).toContain(
      '"https://github.com/Roblis0n/Sestina.git"',
    );
    expect(historyAudit).toContain(
      '"https://github.com/Roblis0n/Sestina"',
    );
  });
});
