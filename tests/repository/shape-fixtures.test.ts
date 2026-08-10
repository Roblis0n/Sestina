/**
 * Negative-fixture tests for check-repository-shape.mjs and
 * check-no-placeholders.mjs.
 *
 * Each test creates a temporary fixture directory, populates it with a
 * minimal repo layout that SHOULD trigger a failure, runs the check
 * script via spawnSync, and asserts exit code 1 + specific error text.
 */
import { describe, it, expect } from "vitest";
import {
  mkdirSync, writeFileSync, rmSync, mkdtempSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

// ── Helpers ──

const SCRIPT_DIR = resolve(import.meta.dirname, "..", "..");
const SHAPE_SCRIPT = resolve(SCRIPT_DIR, "scripts", "check-repository-shape.mjs");
const PLACEHOLDER_SCRIPT = resolve(SCRIPT_DIR, "scripts", "check-no-placeholders.mjs");
const NODE = process.execPath;

/** Create a minimal fixture and run the shape check */
function runShapeCheck(fixtureName: string, setup: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), `sestina-fixture-${fixtureName}-`));
  try {
    // Create minimal workspace structure
    mkdirSync(join(root, "packages"), { recursive: true });
    mkdirSync(join(root, "apps"), { recursive: true });
    mkdirSync(join(root, "integrations"), { recursive: true });

    // Common root files needed for checks 1-3
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "sestina", private: true, type: "module" }));
    writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n  - "apps/*"\n  - "integrations/*"\n');
    writeFileSync(join(root, "tsconfig.base.json"), "{}");
    writeFileSync(join(root, "vitest.workspace.ts"), "export default [];\n");
    writeFileSync(join(root, "eslint.config.mjs"), "export default [];\n");
    writeFileSync(join(root, ".npmrc"), "");
    writeFileSync(join(root, ".node-version"), "24\n");

    // Run setup callback
    setup(root);

    // Run the script
    const result = spawnSync(NODE, [SHAPE_SCRIPT, "--root", root], {
      encoding: "utf-8",
      timeout: 15_000,
    });

    return { root, exitCode: result.status ?? (result.error ? 1 : 0), stderr: result.stderr || "", stdout: result.stdout || "" };
  } catch (e) {
    return { root, exitCode: 99, stderr: String(e), stdout: "" };
  } finally {
    // Cleanup
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ok */ }
  }
}

/** Create a minimal fixture and run the no-placeholders check */
function runPlaceholderCheck(fixtureName: string, setup: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), `sestina-ph-${fixtureName}-`));
  try {
    mkdirSync(join(root, "packages"), { recursive: true });
    mkdirSync(join(root, "apps"), { recursive: true });
    mkdirSync(join(root, "integrations"), { recursive: true });

    setup(root);

    const result = spawnSync(NODE, [PLACEHOLDER_SCRIPT, "--root", root], {
      encoding: "utf-8",
      timeout: 15_000,
    });

    return { root, exitCode: result.status ?? (result.error ? 1 : 0), stderr: result.stderr || "" };
  } catch (e) {
    return { root, exitCode: 99, stderr: String(e) };
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ok */ }
  }
}

/** Helper: create a valid package with exports */
function createValidPackage(root: string, pkgDir: string, pkgName: string, indexContent: string) {
  const dir = join(root, pkgDir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    name: pkgName,
    type: "module",
    exports: { ".": "./src/index.ts", "./package.json": "./package.json" },
  }));
  writeFileSync(join(dir, "src", "index.ts"), indexContent);
}

// ═══════════════════════════════════════════════════════════════════════════
// Negative fixture tests — each creates a minimal repo with ONE violation
// ═══════════════════════════════════════════════════════════════════════════

describe("check-repository-shape negative fixtures", () => {
  // 1. index.ts with only "export" inside comments → MUST FAIL
  it("1. rejects index.ts with only comment-based 'export'", () => {
    const r = runShapeCheck("comment-export", (root) => {
      const dir = join(root, "packages", "foo");
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify({
        name: "@sestina/foo",
        exports: { ".": "./src/index.ts" },
      }));
      // "export" only appears in comments
      writeFileSync(join(dir, "src", "index.ts"),
        "// This module exports utilities\n// See export docs for details\nconst x = 1;\n");
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/no real export/i);
  });

  // 2. package.json missing root exports field → MUST FAIL
  it("2. rejects package.json missing 'exports' field", () => {
    const r = runShapeCheck("no-exports", (root) => {
      const dir = join(root, "packages", "bar");
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify({
        name: "@sestina/bar",
        // No exports field
      }));
      writeFileSync(join(dir, "src", "index.ts"), "export const a = 1;\n");
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/missing.*["']exports["']/i);
  });

  // 3. Cross-package import with subpath: @sestina/foo/internal/x → MUST FAIL
  it("3. rejects bare import with subpath like @sestina/foo/internal/x", () => {
    const r = runShapeCheck("subpath-import", (root) => {
      createValidPackage(root, "packages/foo", "@sestina/foo", "export const FOO = 1;\n");
      createValidPackage(root, "packages/bar", "@sestina/bar", 'import { FOO } from "@sestina/foo/internal/thing";\nexport const BAR = FOO;\n');
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/cross-package.*subpath|imports.*"@sestina\/foo\/internal\//i);
  });

  // 3b. Cross-package import with lib subpath: @sestina/foo/lib/x → MUST FAIL
  it("3b. rejects bare import with lib subpath like @sestina/foo/lib/x", () => {
    const r = runShapeCheck("lib-subpath", (root) => {
      createValidPackage(root, "packages/foo", "@sestina/foo", "export const FOO = 1;\n");
      createValidPackage(root, "packages/baz", "@sestina/baz", 'import { FOO } from "@sestina/foo/lib/helper";\nexport const BAZ = FOO;\n');
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/cross-package.*subpath|imports.*"@sestina\/foo\/lib\//i);
  });

  // 4. Relative import escaping package root → MUST FAIL
  it("4. rejects relative import escaping package root", () => {
    const r = runShapeCheck("relative-escape", (root) => {
      createValidPackage(root, "packages/foo", "@sestina/foo", "export const FOO = 1;\n");
      createValidPackage(root, "packages/bar", "@sestina/bar",
        'import { FOO } from "../../foo/src/index";\nexport const BAR = FOO;\n');
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/relative import escapes/i);
  });

  // 5. apps/ deep-importing shared package internal path → MUST FAIL
  it("5. rejects apps/ deep-importing package internals via subpath", () => {
    const r = runShapeCheck("app-deep-import", (root) => {
      createValidPackage(root, "packages/core", "@sestina/core", "export const core = 1;\n");
      const appDir = join(root, "apps", "desktop");
      mkdirSync(join(appDir, "src"), { recursive: true });
      writeFileSync(join(appDir, "package.json"), JSON.stringify({
        name: "@sestina/desktop",
        exports: { ".": "./src/index.ts" },
      }));
      writeFileSync(join(appDir, "src", "index.ts"),
        'import { core } from "@sestina/core/src/deep-internal";\nexport const app = core;\n');
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/cross-package.*subpath|imports.*"@sestina\/core\/src\//i);
  });

  // 6. Side-effect import with subpath → MUST FAIL
  it("6. rejects side-effect import with subpath", () => {
    const r = runShapeCheck("side-effect-subpath", (root) => {
      createValidPackage(root, "packages/foo", "@sestina/foo", "export const FOO = 1;\n");
      createValidPackage(root, "packages/bar", "@sestina/bar",
        'import "@sestina/foo/internal/setup";\nexport const BAR = 1;\n');
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/cross-package.*subpath|imports.*"@sestina\/foo\/internal\//i);
  });

  // 7. Renderer importing forbidden dependencies → MUST FAIL
  it("7. rejects renderer importing core/storage/secrets/providers", () => {
    const r = runShapeCheck("renderer-core", (root) => {
      createValidPackage(root, "packages/core", "@sestina/core", "export const coreFn = () => {};\n");
      const renderDir = join(root, "apps", "desktop");
      mkdirSync(join(renderDir, "renderer"), { recursive: true });
      mkdirSync(join(renderDir, "src"), { recursive: true });
      writeFileSync(join(renderDir, "package.json"), JSON.stringify({
        name: "@sestina/desktop",
        exports: { ".": "./src/index.ts" },
      }));
      writeFileSync(join(renderDir, "src", "index.ts"), "export const main = 1;\n");
      writeFileSync(join(renderDir, "renderer", "App.tsx"),
        'import { coreFn } from "@sestina/core";\ncoreFn();\n');
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/renderer.*must not depend on.*core/i);
  });

  // 7b. Renderer importing another forbidden dep
  it("7b. rejects renderer importing secrets via subpath", () => {
    const r = runShapeCheck("renderer-secrets", (root) => {
      createValidPackage(root, "packages/secrets", "@sestina/secrets", "export const secret = 1;\n");
      const renderDir = join(root, "apps", "desktop");
      mkdirSync(join(renderDir, "renderer"), { recursive: true });
      mkdirSync(join(renderDir, "src"), { recursive: true });
      writeFileSync(join(renderDir, "package.json"), JSON.stringify({
        name: "@sestina/desktop",
        exports: { ".": "./src/index.ts" },
      }));
      writeFileSync(join(renderDir, "src", "index.ts"), "export const main = 1;\n");
      writeFileSync(join(renderDir, "renderer", "View.tsx"),
        'import { secret } from "@sestina/secrets/leak";\n');
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/renderer.*must not depend on.*secrets/i);
  });

  // 8. Unexpanded variables in release/artifacts/packaging → MUST FAIL
  it("8. rejects unexpanded template variables in release manifest", () => {
    const r = runShapeCheck("unexpanded-vars", (root) => {
      createValidPackage(root, "packages/foo", "@sestina/foo", "export const FOO = 1;\n");
      const relDir = join(root, "release");
      mkdirSync(relDir, { recursive: true });
      writeFileSync(join(relDir, "manifest.json"),
        JSON.stringify({ version: "${VERSION}", name: "sestina-${ARCH}" }));
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/unexpanded variable/i);
  });

  it("8b. rejects {{ mustache }} templates in packaging", () => {
    const r = runShapeCheck("mustache-vars", (root) => {
      createValidPackage(root, "packages/foo", "@sestina/foo", "export const FOO = 1;\n");
      const pkgDir = join(root, "packaging");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, "installer.nsh"), '!define VERSION "{{version}}"\n');
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/unexpanded variable/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// No-placeholders negative fixture tests
// ═══════════════════════════════════════════════════════════════════════════

describe("check-no-placeholders negative fixtures", () => {
  // 9. Line with both "check-no-placeholders" AND a real PLACEHOLDER → MUST catch the real one
  it("9. catches real PLACEHOLDER on same line as check-no-placeholders reference", () => {
    const r = runPlaceholderCheck("same-line", (root) => {
      writeFileSync(join(root, "packages", "source.ts"),
        '// Test: check-no-placeholders should not hide a real PLACEHOLDER on the same line\n');
    });
    expect(r.exitCode).not.toBe(0);
    // Must report the second "PLACEHOLDER" but not the one in "check-no-placeholders"
    expect(r.stderr).toContain("PLACEHOLDER");
    // Should still find something (the real PLACEHOLDER)
    expect(r.stderr).toMatch(/placeholder\(s\) found/i);
  });
});
