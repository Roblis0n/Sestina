/**
 * Negative/positive fixture tests for verify-clean-package.mjs.
 *
 * Strict-mode rules only apply to NEW product packages; the 8 legacy
 * packages are exempt from strict checks (they stay governed by
 * check-repository-shape.mjs) so historical gaps cannot block RI-03.
 *
 * Rule IDs (docs/architecture/01-DEPENDENCY-RULES.md):
 *   PKG-R001 strict package has a parsable package.json with a valid
 *             @sestina/* name
 *   PKG-R002 type must be "module"
 *   PKG-R003 private must be true until publishing is approved
 *   PKG-R004 exports["."] must be declared
 *   PKG-R005 the root export target must exist on disk
 *   PKG-R006 at least one of test/build/typecheck scripts must be declared
 *   PKG-R007 no database/WAL/log/key/backup files as package assets
 *   PKG-R008 workspace dependencies must stay inside the architecture allowlist
 *   PKG-R009 no deep @sestina/* subpath imports bypassing public exports
 *   PKG-R010 no personal absolute paths inside package sources
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const SCRIPT_DIR = resolve(import.meta.dirname, "..", "..");
const CLEAN_SCRIPT = resolve(SCRIPT_DIR, "scripts", "verify-clean-package.mjs");
const NODE = process.execPath;

function runCleanPackage(
  fixtureName: string,
  setup: (root: string) => void,
): { exitCode: number; stderr: string } {
  const root = mkdtempSync(join(tmpdir(), `sestina-pkg-${fixtureName}-`));
  try {
    mkdirSync(join(root, "packages"), { recursive: true });
    mkdirSync(join(root, "apps"), { recursive: true });
    mkdirSync(join(root, "integrations"), { recursive: true });
    setup(root);
    const result = spawnSync(NODE, [CLEAN_SCRIPT, "--root", root], {
      encoding: "utf-8",
      timeout: 15_000,
    });
    return {
      exitCode: result.status ?? (result.error ? 1 : 0),
      stderr: result.stderr || "",
    };
  } finally {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* ok */
    }
  }
}

interface PkgManifest {
  name?: string;
  type?: string;
  private?: boolean;
  exports?: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
}
/** Write a strict-mode package with an index file and a manifest. */
function writeStrictPackage(
  root: string,
  pkgDir: string,
  manifest: PkgManifest,
  indexContent = "export const value = 1;\n",
): void {
  const dir = join(root, pkgDir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "src", "index.ts"),
    indexContent,
  );
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
}

const VALID_STRICT_MANIFEST: PkgManifest = {
  name: "@sestina/research",
  type: "module",
  private: true,
  exports: { ".": "./src/index.ts", "./package.json": "./package.json" },
  scripts: { test: "vitest run", build: "tsc", typecheck: "tsc --noEmit" },
  dependencies: { "@sestina/schema": "workspace:*" },
};

// ═══════════════════════════════════════════════════════════════════════════
// Positive fixtures
// ═══════════════════════════════════════════════════════════════════════════

describe("verify-clean-package positive fixtures", () => {
  it("P1. a compliant new package passes strict mode", () => {
    const r = runCleanPackage("pos-valid", (root) => {
      writeStrictPackage(root, "packages/research", VALID_STRICT_MANIFEST);
    });
    expect(r.exitCode).toBe(0);
  });

  it("P2. absent new packages are not an error", () => {
    const r = runCleanPackage("pos-absent", (root) => {
      mkdirSync(join(root, "packages", "schema"), { recursive: true });
      writeFileSync(
        join(root, "packages", "schema", "package.json"),
        JSON.stringify({ name: "@sestina/schema", type: "module" }),
      );
    });
    expect(r.exitCode).toBe(0);
  });

  it("P3. legacy packages are not strict (missing private does not block RI-03)", () => {
    const r = runCleanPackage("pos-legacy", (root) => {
      writeStrictPackage(root, "packages/evidence", {
        name: "@sestina/evidence",
        type: "module",
        exports: { ".": "./src/index.ts" },
      });
    });
    expect(r.exitCode).toBe(0);
  });

  it("P4. RI-39 CLI and Skill package dependency boundaries pass strict mode", () => {
    const r = runCleanPackage("pos-ri39", (root) => {
      writeStrictPackage(root, "apps/cli", {
        ...VALID_STRICT_MANIFEST,
        name: "@sestina/cli",
        dependencies: {
          "@sestina/core": "workspace:*",
          "@sestina/mcp": "workspace:*",
          "@sestina/skills": "workspace:*",
        },
      });
      writeStrictPackage(root, "integrations/skills", {
        ...VALID_STRICT_MANIFEST,
        name: "@sestina/skills",
        dependencies: {},
      });
    });
    expect(r.exitCode).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Negative fixtures
// ═══════════════════════════════════════════════════════════════════════════

describe("verify-clean-package negative fixtures", () => {
  it("N1. missing private:true fails as PKG-R003", () => {
    const r = runCleanPackage("neg-private", (root) => {
      const manifest = { ...VALID_STRICT_MANIFEST };
      delete manifest.private;
      writeStrictPackage(root, "packages/research", manifest);
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[PKG-R003]");
    expect(r.stderr).toContain("packages/research");
  });

  it("N2. missing exports['.'] fails as PKG-R004", () => {
    const r = runCleanPackage("neg-exports", (root) => {
      writeStrictPackage(root, "packages/research", {
        ...VALID_STRICT_MANIFEST,
        exports: { "./package.json": "./package.json" },
      });
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[PKG-R004]");
  });

  it("N3. root export target missing on disk fails as PKG-R005", () => {
    const r = runCleanPackage("neg-target", (root) => {
      const manifest = {
        ...VALID_STRICT_MANIFEST,
        exports: { ".": "./src/missing.ts" },
      };
      const dir = join(root, "packages/research");
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "other.ts"), "export const v = 1;\n");
      writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[PKG-R005]");
  });

  it("N4. database asset inside a new package fails as PKG-R007", () => {
    const r = runCleanPackage("neg-db", (root) => {
      writeStrictPackage(root, "packages/research", VALID_STRICT_MANIFEST);
      writeFileSync(
        join(root, "packages/research", "src", "seed.db"),
        "binary-ish content",
      );
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[PKG-R007]");
    expect(r.stderr).toContain("seed.db");
  });

  it("N4b. WAL and log assets fail as PKG-R007", () => {
    const r = runCleanPackage("neg-wal", (root) => {
      writeStrictPackage(root, "packages/review", {
        ...VALID_STRICT_MANIFEST,
        name: "@sestina/review",
      });
      writeFileSync(
        join(root, "packages/review", "run.log"),
        "log line",
      );
      writeFileSync(
        join(root, "packages/review", "state.db-wal"),
        "wal",
      );
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[PKG-R007]");
  });

  it("N5. key material inside a new package fails as PKG-R007", () => {
    const r = runCleanPackage("neg-key", (root) => {
      writeStrictPackage(root, "packages/reports", {
        ...VALID_STRICT_MANIFEST,
        name: "@sestina/reports",
      });
      writeFileSync(
        join(root, "packages/reports", "src", "signing.key"),
        "secret material",
      );
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[PKG-R007]");
  });

  it("N6. disallowed workspace dependency fails as PKG-R008", () => {
    const r = runCleanPackage("neg-dep", (root) => {
      writeStrictPackage(root, "packages/research", {
        ...VALID_STRICT_MANIFEST,
        dependencies: {
          "@sestina/schema": "workspace:*",
          "@sestina/evidence": "workspace:*",
        },
      });
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[PKG-R008]");
    expect(r.stderr).toContain("@sestina/evidence");
  });

  it("N7. deep @sestina subpath import fails as PKG-R009", () => {
    const r = runCleanPackage("neg-deep", (root) => {
      writeStrictPackage(
        root,
        "packages/research",
        VALID_STRICT_MANIFEST,
        'import { X } from "@sestina/schema/internal/ids";\nexport const Y = X;\n',
      );
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[PKG-R009]");
    expect(r.stderr).toContain("@sestina/schema/internal/ids");
  });

  it("N8. personal absolute path in sources fails as PKG-R010", () => {
    const r = runCleanPackage("neg-personal-path", (root) => {
      writeStrictPackage(
        root,
        "packages/core",
        {
          ...VALID_STRICT_MANIFEST,
          name: "@sestina/core",
          dependencies: { "@sestina/review": "workspace:*" },
        },
        'export const p = "C:\\Users\\someone\\notes.txt";\n',
      );
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[PKG-R010]");
  });

  it("N9. manifest without any test/build/typecheck script fails as PKG-R006", () => {
    const r = runCleanPackage("neg-scripts", (root) => {
      writeStrictPackage(root, "packages/research", {
        name: "@sestina/research",
        type: "module",
        private: true,
        exports: { ".": "./src/index.ts" },
      });
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[PKG-R006]");
  });

  it("N10. non-module type fails as PKG-R002", () => {
    const r = runCleanPackage("neg-commonjs", (root) => {
      writeStrictPackage(root, "packages/research", {
        ...VALID_STRICT_MANIFEST,
        type: "commonjs",
      });
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[PKG-R002]");
  });

  it("N11. new package does not inherit the legacy exemption", () => {
    const r = runCleanPackage("neg-no-legacy-pass", (root) => {
      // A strict-mode package with a legacy-style manifest must fail even
      // though the identical manifest passes for legacy directories (P3).
      writeStrictPackage(root, "integrations/mcp", {
        name: "@sestina/mcp",
        type: "module",
        exports: { ".": "./src/index.ts" },
      });
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[PKG-R003]");
  });
});
