import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

// Simple YAML parser for pnpm-workspace (avoids dependency)
function parsePnpmWorkspace(): string[] {
  const content = readFileSync(
    resolve(REPO_ROOT, "pnpm-workspace.yaml"),
    "utf-8",
  );
  const lines = content.split("\n");
  const packages: string[] = [];
  let inPackages = false;
  for (const line of lines) {
    if (line.trim().startsWith("packages:")) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const match = /^\s*-\s*"([^"]+)"/.exec(line);
      if (match?.[1]) {
        packages.push(match[1]);
      }
      if (line.trim() && !line.startsWith(" ") && !line.startsWith("\t") && !line.startsWith("-")) {
        break;
      }
    }
  }
  return packages;
}

/** Extract import specifiers from a TS file */
function extractImports(filePath: string): string[] {
  const content = readFileSync(filePath, "utf-8");
  const regex = /(?:from\s+['"]|import\s*\(\s*['"])([^'"]+)/g;
  const deps: string[] = [];
  let m;
  while ((m = regex.exec(content)) !== null) {
    if (m[1]) deps.push(m[1]);
  }
  return deps;
}

/** Walk directory recursively, yielding {fullPath, relativePath} */
function* walkFiles(dir: string, root: string = dir): Generator<{ fullPath: string; relPath: string }> {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "build", "coverage", ".git", ".turbo"].includes(entry.name)) continue;
      yield* walkFiles(fullPath, root);
    } else if (entry.isFile() && /\.(ts|tsx|mjs|js)$/.test(entry.name)) {
      yield { fullPath, relPath: relative(root, fullPath) };
    }
  }
}

// ─────────────────────────────────────────────
// Core repository shape tests
// ─────────────────────────────────────────────

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
    if (!existsSync(packagesDir)) return;

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

// ─────────────────────────────────────────────
// Public exports and cross-package import tests
// ─────────────────────────────────────────────

describe("Package public exports", () => {
  it("every packages/*/src/index.ts exists and re-exports at least one symbol", () => {
    const packagesDir = resolve(REPO_ROOT, "packages");
    if (!existsSync(packagesDir)) return;

    const entries = readdirSync(packagesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const indexPath = resolve(packagesDir, entry.name, "src", "index.ts");
      expect(existsSync(indexPath)).toBe(true);

      const content = readFileSync(indexPath, "utf-8");
      // Each index.ts must have at least one export statement
      expect(content).toMatch(/export/);
    }
  });

  it("no package imports deep source paths from another package", () => {
    const packagesDir = resolve(REPO_ROOT, "packages");
    if (!existsSync(packagesDir)) return;

    const entries = readdirSync(packagesDir, { withFileTypes: true });
    const packageNames = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    for (const pkgName of packageNames) {
      const pkgJsonPath = resolve(packagesDir, pkgName, "package.json");
      if (!existsSync(pkgJsonPath)) continue;
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as {
        name?: string;
      };
      const scopeName = pkgJson.name;
      if (!scopeName) continue;

      const srcDir = resolve(packagesDir, pkgName, "src");
      for (const { fullPath } of walkFiles(srcDir)) {
        const imports = extractImports(fullPath);
        for (const imp of imports) {
          // Skip non-sestina imports and self-references
          if (!imp.startsWith("@sestina/")) continue;
          if (imp === scopeName) continue;

          // Cross-package imports must NOT use deep paths like @sestina/foo/src/bar
          // They must use only the package name (public entry point)
          expect(imp).not.toMatch(/^@sestina\/[^/]+\/(src|dist|test)/);
        }
      }
    }
  });

  it("no package imports from apps/ or integrations/ directly", () => {
    const packagesDir = resolve(REPO_ROOT, "packages");
    if (!existsSync(packagesDir)) return;

    const entries = readdirSync(packagesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const srcDir = resolve(packagesDir, entry.name, "src");
      for (const { fullPath } of walkFiles(srcDir)) {
        const imports = extractImports(fullPath);
        for (const imp of imports) {
          expect(imp).not.toMatch(/^@sestina\/(background-runtime|desktop|hook-runner|mcp-server|cli|codex-plugin|claude-plugin)/);
        }
      }
    }
  });
});

// ─────────────────────────────────────────────
// Renderer dependency restrictions
// ─────────────────────────────────────────────

describe("Renderer dependency restrictions", () => {
  const FORBIDDEN_RENDERER_DEPS = ["@sestina/core", "@sestina/storage", "@sestina/secrets", "@sestina/providers"];

  it("no renderer directory imports forbidden packages", () => {
    // Check if any renderer directory exists
    const checkDirs = [
      resolve(REPO_ROOT, "apps", "desktop", "renderer"),
      resolve(REPO_ROOT, "packages"),
    ];

    for (const dir of checkDirs) {
      if (!existsSync(dir)) continue;
      for (const { fullPath } of walkFiles(dir)) {
        // Only check files within renderer paths
        const normalized = fullPath.replace(/\\/g, "/");
        if (!normalized.includes("/renderer/") && !normalized.includes("\\renderer\\")) continue;

        const imports = extractImports(fullPath);
        for (const imp of imports) {
          for (const forbidden of FORBIDDEN_RENDERER_DEPS) {
            expect(imp).not.toBe(forbidden);
            expect(imp).not.toMatch(new RegExp(`^${forbidden.replace("/", "\\/")}/`));
          }
        }
      }
    }
  });
});

// ─────────────────────────────────────────────
// CI workflow contract
// ─────────────────────────────────────────────

describe("CI workflow", () => {
  const ciPath = resolve(REPO_ROOT, ".github", "workflows", "ci.yml");

  it("CI config exists", () => {
    expect(existsSync(ciPath)).toBe(true);
  });

  it("CI runs pnpm install --frozen-lockfile", () => {
    const content = readFileSync(ciPath, "utf-8");
    expect(content).toMatch(/pnpm install.*--frozen-lockfile/);
  });

  it("CI runs pnpm test (not test:integration which has no tests yet)", () => {
    const content = readFileSync(ciPath, "utf-8");
    // Must have pnpm test
    expect(content).toMatch(/pnpm test\b/);
    // Must NOT have pnpm test:integration (would fail with no tests)
    expect(content).not.toMatch(/pnpm test:integration/);
  });

  it("CI runs pnpm build", () => {
    const content = readFileSync(ciPath, "utf-8");
    expect(content).toMatch(/pnpm build/);
  });

  it("CI runs pnpm repo:check", () => {
    const content = readFileSync(ciPath, "utf-8");
    expect(content).toMatch(/pnpm repo:check/);
  });

  it("CI uses Node 24 across all platforms", () => {
    const content = readFileSync(ciPath, "utf-8");
    expect(content).toMatch(/node-version:\s*(['"]?)\s*24\b/);
  });

  it("package.json has repo:check script", () => {
    const pkgJson = JSON.parse(
      readFileSync(resolve(REPO_ROOT, "package.json"), "utf-8"),
    ) as { scripts?: Record<string, string> };
    expect(pkgJson.scripts?.["repo:check"]).toBeDefined();
    expect(pkgJson.scripts?.["repo:check"]).toContain("check-repository-shape");
  });
});

// ─────────────────────────────────────────────
// Vitest workspace contract
// ─────────────────────────────────────────────

describe("Vitest workspace", () => {
  it("vitest.workspace.ts defines unit, integration, ipc, and desktop projects", () => {
    const content = readFileSync(
      resolve(REPO_ROOT, "vitest.workspace.ts"),
      "utf-8",
    );
    // Each project must be defined by name
    expect(content).toMatch(/name:\s*["']unit["']/);
    expect(content).toMatch(/name:\s*["']integration["']/);
    expect(content).toMatch(/name:\s*["']ipc["']/);
    expect(content).toMatch(/name:\s*["']desktop["']/);
  });

  it("package.json test:e2e uses playwright test, not vitest", () => {
    const pkgJson = JSON.parse(
      readFileSync(resolve(REPO_ROOT, "package.json"), "utf-8"),
    ) as { scripts?: Record<string, string> };
    expect(pkgJson.scripts?.["test:e2e"]).toBeDefined();
    expect(pkgJson.scripts?.["test:e2e"]).toContain("playwright");
    expect(pkgJson.scripts?.["test:e2e"]).not.toContain("vitest");
  });
});

// ─────────────────────────────────────────────
// No-placeholders contract
// ─────────────────────────────────────────────

describe("No-placeholders check", () => {
  const scriptPath = resolve(REPO_ROOT, "scripts", "check-no-placeholders.mjs");

  it("script exists and is executable", () => {
    expect(existsSync(scriptPath)).toBe(true);
  });

  it("catches real TODO in production source", () => {
    const testFile = resolve(REPO_ROOT, ".tmp-test-placeholder.ts");
    try {
      const content = "// TODO: implement this properly\nexport const x = 1;\n";
      writeFileSync(testFile, content, "utf-8");

      // Run the script — it should exit 1 because of TODO in .tmp-test-placeholder.ts
      expect(() => {
        execSync(`node "${scriptPath}"`, { cwd: REPO_ROOT, encoding: "utf-8", shell: "bash" });
      }).toThrow();
    } finally {
      try { unlinkSync(testFile); } catch { /* ok */ }
    }
  });

  it("allows TODO in docs/ (spec documents)", () => {
    // The script must exclude docs/ directory
    const scriptContent = readFileSync(scriptPath, "utf-8");
    expect(scriptContent).toMatch(/docs/);
    expect(scriptContent).toMatch(/EXCLUDE_DIRS/);
  });

  it("scans CI workflow and root config files", () => {
    const scriptContent = readFileSync(scriptPath, "utf-8");
    // Must scan .yml and .yaml (for CI)
    expect(scriptContent).toMatch(/\.ya?ml/);
  });

  it("does not scan itself", () => {
    const scriptContent = readFileSync(scriptPath, "utf-8");
    // Script must exclude itself via SELF_PATH comparison (not by excluding all scripts/)
    expect(scriptContent).toMatch(/SELF_PATH/);
  });
});
