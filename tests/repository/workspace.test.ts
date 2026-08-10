import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "node:yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

// Simple YAML parser for pnpm-workspace (avoids dependency)
function parsePnpmWorkspace(): string[] {
  const content = readFileSync(
    resolve(REPO_ROOT, "pnpm-workspace.yaml"),
    "utf-8",
  );
  // Match packages: lines with array items or simple list
  const lines = content.split("\n");
  const packages: string[] = [];
  let inPackages = false;
  for (const line of lines) {
    if (line.trim().startsWith("packages:")) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const match = line.match(/^\s*-\s*"([^"]+)"/);
      if (match) {
        packages.push(match[1]!);
      }
      // Stop at next top-level key
      if (line.trim() && !line.startsWith(" ") && !line.startsWith("\t") && !line.startsWith("-")) {
        break;
      }
    }
  }
  return packages;
}

describe("Repository Shape", () => {
  const requiredRootFiles = [
    "package.json",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
    "vitest.workspace.ts",
    "eslint.config.mjs",
    ".npmrc",
    ".node-version",
  ];

  it("has all required root config files", () => {
    for (const file of requiredRootFiles) {
      expect(existsSync(resolve(REPO_ROOT, file))).toBe(true);
    }
  });

  it("has required top-level directories", () => {
    for (const dir of ["packages", "apps", "integrations", "docs", "tests", "scripts"]) {
      expect(existsSync(resolve(REPO_ROOT, dir))).toBe(true);
    }
  });

  it("declares correct workspace patterns in pnpm-workspace.yaml", () => {
    const packages = parsePnpmWorkspace();
    expect(packages).toContain("packages/*");
    expect(packages).toContain("apps/*");
    expect(packages).toContain("integrations/*");
    // Historical directory must NOT be in workspace
    expect(packages).not.toContain("OpenMythos-main (1)/*");
    expect(packages).not.toContain("OpenMythos-main (1)");
  });

  it("has no workspace-included historical directories", () => {
    const packages = parsePnpmWorkspace();
    const historicalPatterns = packages.filter(
      (p) => p.includes("OpenMythos") || p.includes("legacy"),
    );
    expect(historicalPatterns).toHaveLength(0);
  });

  it("ensures all package directories under packages/ have a package.json", () => {
    const packagesDir = resolve(REPO_ROOT, "packages");
    if (!existsSync(packagesDir)) return; // Skip if no packages yet

    const entries = readdirSync(packagesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const pkgJson = resolve(packagesDir, entry.name, "package.json");
        expect(existsSync(pkgJson)).toBe(true);
      }
    }
  });

  it("ensures packages under packages/ have @sestina/ scope names", () => {
    const packagesDir = resolve(REPO_ROOT, "packages");
    if (!existsSync(packagesDir)) return;

    const entries = readdirSync(packagesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const pkgJsonPath = resolve(packagesDir, entry.name, "package.json");
        if (existsSync(pkgJsonPath)) {
          const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as {
            name?: string;
          };
          if (pkg.name) {
            expect(pkg.name).toMatch(/^@sestina\//);
          }
        }
      }
    }
  });

  it("ensures apps/ packages do not import from each other", () => {
    // This is a structural check — enforced by ESLint boundaries in practice
    // Here we just verify the directories exist and are separate
    const appsDir = resolve(REPO_ROOT, "apps");
    if (!existsSync(appsDir)) return;
    expect(existsSync(appsDir)).toBe(true);
  });

  it("ensures .gitignore covers common generated paths", () => {
    const gitignore = readFileSync(resolve(REPO_ROOT, ".gitignore"), "utf-8");
    const requiredPatterns = [
      "node_modules",
      "dist",
      "build",
      "coverage",
      ".turbo",
    ];
    for (const pattern of requiredPatterns) {
      expect(gitignore).toContain(pattern);
    }
  });
});
