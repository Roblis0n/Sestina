/**
 * Negative/positive fixture tests for verify-architecture.mjs.
 *
 * Each test creates a temporary fixture workspace, writes packages with a
 * specific import shape, runs the verifier via spawnSync, and asserts the
 * exit code plus the rule ID / file / specifier in the error output.
 *
 * Rule IDs (docs/architecture/01-DEPENDENCY-RULES.md):
 *   ARCH-R001 research          -> only @sestina/schema (+ pure third-party)
 *   ARCH-R002 research-store    -> research, review, schema, storage
 *   ARCH-R003 review            -> research, schema; never storage/research-store
 *   ARCH-R004 reports           -> research, review, schema
 *   ARCH-R005 core              -> research, research-store, review, reports,
 *                                  config, secrets, schema
 *   ARCH-R006 apps/cli          -> @sestina/core, @sestina/mcp, @sestina/skills
 *   ARCH-R007 integrations/mcp  -> only @sestina/core
 *   ARCH-R008 integrations/legacy-import -> read-only legacy boundary
 *   ARCH-R009 no new product package may import @sestina/events,
 *             @sestina/projects, @sestina/contracts, @sestina/evidence
 *   ARCH-R010 integrations/skills -> no @sestina/* dependencies
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const SCRIPT_DIR = resolve(import.meta.dirname, "..", "..");
const ARCH_SCRIPT = resolve(SCRIPT_DIR, "scripts", "verify-architecture.mjs");
const NODE = process.execPath;

function runArchitecture(
  fixtureName: string,
  setup: (root: string) => void,
): { exitCode: number; stderr: string; stdout: string } {
  const root = mkdtempSync(join(tmpdir(), `sestina-arch-${fixtureName}-`));
  try {
    mkdirSync(join(root, "packages"), { recursive: true });
    mkdirSync(join(root, "apps"), { recursive: true });
    mkdirSync(join(root, "integrations"), { recursive: true });
    setup(root);
    const result = spawnSync(NODE, [ARCH_SCRIPT, "--root", root], {
      encoding: "utf-8",
      timeout: 15_000,
    });
    return {
      exitCode: result.status ?? (result.error ? 1 : 0),
      stderr: result.stderr || "",
      stdout: result.stdout || "",
    };
  } finally {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* ok */
    }
  }
}

/** Write a source file inside a workspace package (auto package.json). */
function writeModule(
  root: string,
  pkgDir: string,
  relFile: string,
  content: string,
): void {
  const absFile = join(root, pkgDir, relFile);
  mkdirSync(dirname(absFile), { recursive: true });
  writeFileSync(absFile, content);
  const pkgJson = join(root, pkgDir, "package.json");
  writeFileSync(
    pkgJson,
    JSON.stringify({
      name: `@sestina/${pkgDir.split("/").pop()}`,
      type: "module",
    }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Positive fixtures - allowed dependency shapes must exit 0
// ═══════════════════════════════════════════════════════════════════════════

describe("verify-architecture positive fixtures", () => {
  it("P1. research -> schema is allowed", () => {
    const r = runArchitecture("pos-research-schema", (root) => {
      writeModule(
        root,
        "packages/research",
        "src/index.ts",
        'import { X } from "@sestina/schema";\nexport const Y = X;\n',
      );
    });
    expect(r.exitCode).toBe(0);
  });

  it("P2. research-store -> research/review/schema/storage are all allowed", () => {
    const r = runArchitecture("pos-store", (root) => {
      writeModule(
        root,
        "packages/research-store",
        "src/index.ts",
        [
          'import { A } from "@sestina/research";',
          'import { B } from "@sestina/review";',
          'import { C } from "@sestina/schema";',
          'import { D } from "@sestina/storage";',
          "export const E = [A, B, C, D];",
        ].join("\n"),
      );
    });
    expect(r.exitCode).toBe(0);
  });

  it("P3. review -> research is allowed", () => {
    const r = runArchitecture("pos-review-research", (root) => {
      writeModule(
        root,
        "packages/review",
        "src/index.ts",
        'import { R } from "@sestina/research";\nexport const V = R;\n',
      );
    });
    expect(r.exitCode).toBe(0);
  });

  it("P4. reports -> review is allowed", () => {
    const r = runArchitecture("pos-reports-review", (root) => {
      writeModule(
        root,
        "packages/reports",
        "src/index.ts",
        'import { F } from "@sestina/review";\nexport const G = F;\n',
      );
    });
    expect(r.exitCode).toBe(0);
  });

  it("P5. apps/cli -> core/mcp/skills are allowed", () => {
    const r = runArchitecture("pos-cli-core", (root) => {
      writeModule(
        root,
        "apps/cli",
        "src/main.ts",
        [
          'import { core } from "@sestina/core";',
          'import { openProjectReader } from "@sestina/mcp";',
          'import { CODEX_RESEARCH_INTEGRITY_SKILL } from "@sestina/skills";',
          'export const cli = [core, openProjectReader, CODEX_RESEARCH_INTEGRITY_SKILL];',
        ].join("\n"),
      );
    });
    expect(r.exitCode).toBe(0);
  });

  it("P6. integrations/mcp -> core is allowed", () => {
    const r = runArchitecture("pos-mcp-core", (root) => {
      writeModule(
        root,
        "integrations/mcp",
        "src/main.ts",
        'import { core } from "@sestina/core";\nexport const mcp = core;\n',
      );
    });
    expect(r.exitCode).toBe(0);
  });

  it("P7. integrations/legacy-import -> evidence is allowed (sole legacy boundary)", () => {
    const r = runArchitecture("pos-legacy-import", (root) => {
      writeModule(
        root,
        "integrations/legacy-import",
        "src/map-evidence.ts",
        'import { E } from "@sestina/evidence";\nexport const M = E;\n',
      );
    });
    expect(r.exitCode).toBe(0);
  });

  it("P8. core may compose research-store/review/reports/config/secrets", () => {
    const r = runArchitecture("pos-core-compose", (root) => {
      writeModule(
        root,
        "packages/core",
        "src/index.ts",
        [
          'import { A } from "@sestina/research-store";',
          'import { B } from "@sestina/review";',
          'import { C } from "@sestina/reports";',
          'import { D } from "@sestina/config";',
          'import { E } from "@sestina/secrets";',
          "export const core = [A, B, C, D, E];",
        ].join("\n"),
      );
    });
    expect(r.exitCode).toBe(0);
  });

  it("P9. fixture with only legacy packages and no new packages exits 0", () => {
    const r = runArchitecture("pos-legacy-only", (root) => {
      writeModule(
        root,
        "packages/evidence",
        "src/index.ts",
        'import { S } from "@sestina/schema";\nexport const T = S;\n',
      );
    });
    expect(r.exitCode).toBe(0);
  });

  it("P10. integrations/skills may use third-party generation utilities", () => {
    const r = runArchitecture("pos-skills-third-party", (root) => {
      writeModule(
        root,
        "integrations/skills",
        "src/index.ts",
        'import { parse } from "yaml";\nexport const skill = parse("name: test");\n',
      );
    });
    expect(r.exitCode).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Negative fixtures - forbidden dependency shapes must exit 1
// ═══════════════════════════════════════════════════════════════════════════

describe("verify-architecture negative fixtures", () => {
  it("N1. research -> evidence is rejected as ARCH-R009", () => {
    const r = runArchitecture("neg-research-evidence", (root) => {
      writeModule(
        root,
        "packages/research",
        "src/index.ts",
        'import { E } from "@sestina/evidence";\nexport const Y = E;\n',
      );
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[ARCH-R009]");
    expect(r.stderr).toContain("packages/research/src/index.ts");
    expect(r.stderr).toContain("@sestina/evidence");
  });

  it("N2. research -> storage is rejected as ARCH-R001", () => {
    const r = runArchitecture("neg-research-storage", (root) => {
      writeModule(
        root,
        "packages/research",
        "src/index.ts",
        'import { DB } from "@sestina/storage";\nexport const Y = DB;\n',
      );
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[ARCH-R001]");
    expect(r.stderr).toContain("@sestina/storage");
  });

  it("N3. review -> storage is rejected as ARCH-R003", () => {
    const r = runArchitecture("neg-review-storage", (root) => {
      writeModule(
        root,
        "packages/review",
        "src/x.ts",
        'import { DB } from "@sestina/storage";\nexport const Y = DB;\n',
      );
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[ARCH-R003]");
    expect(r.stderr).toContain("packages/review/src/x.ts");
    expect(r.stderr).toContain("@sestina/storage");
  });

  it("N4. review -> research-store is rejected as ARCH-R003", () => {
    const r = runArchitecture("neg-review-store", (root) => {
      writeModule(
        root,
        "packages/review",
        "src/index.ts",
        'import { S } from "@sestina/research-store";\nexport const Y = S;\n',
      );
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[ARCH-R003]");
    expect(r.stderr).toContain("@sestina/research-store");
  });

  it("N5. apps/cli -> storage is rejected as ARCH-R006", () => {
    const r = runArchitecture("neg-cli-storage", (root) => {
      writeModule(
        root,
        "apps/cli",
        "src/main.ts",
        'import { DB } from "@sestina/storage";\nexport const Y = DB;\n',
      );
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[ARCH-R006]");
    expect(r.stderr).toContain("@sestina/storage");
  });

  it("N6. apps/cli -> legacy evidence package is rejected", () => {
    const r = runArchitecture("neg-cli-evidence", (root) => {
      writeModule(
        root,
        "apps/cli",
        "src/main.ts",
        'import { E } from "@sestina/evidence";\nexport const Y = E;\n',
      );
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[ARCH-R009]");
  });

  it("N7. integrations/mcp -> storage is rejected as ARCH-R007", () => {
    const r = runArchitecture("neg-mcp-storage", (root) => {
      writeModule(
        root,
        "integrations/mcp",
        "src/main.ts",
        'import { DB } from "@sestina/storage";\nexport const Y = DB;\n',
      );
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[ARCH-R007]");
    expect(r.stderr).toContain("@sestina/storage");
  });

  it("N8. dynamic import() cannot bypass review -> storage ban", () => {
    const r = runArchitecture("neg-dynamic-import", (root) => {
      writeModule(
        root,
        "packages/review",
        "src/index.ts",
        'export const Y = async () => (await import("@sestina/storage")).DB;\n',
      );
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[ARCH-R003]");
    expect(r.stderr).toContain("@sestina/storage");
  });

  it("N9. export-from cannot bypass research -> storage ban", () => {
    const r = runArchitecture("neg-export-from", (root) => {
      writeModule(
        root,
        "packages/research",
        "src/index.ts",
        'export { DB } from "@sestina/storage";\n',
      );
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[ARCH-R001]");
    expect(r.stderr).toContain("@sestina/storage");
  });

  it("N10. side-effect import cannot bypass legacy package ban", () => {
    const r = runArchitecture("neg-side-effect", (root) => {
      writeModule(
        root,
        "packages/research",
        "src/index.ts",
        'import "@sestina/events";\nexport const Y = 1;\n',
      );
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[ARCH-R009]");
    expect(r.stderr).toContain("@sestina/events");
  });

  it("N11. reports -> research-store is rejected as ARCH-R004", () => {
    const r = runArchitecture("neg-reports-store", (root) => {
      writeModule(
        root,
        "packages/reports",
        "src/index.ts",
        'import { S } from "@sestina/research-store";\nexport const Y = S;\n',
      );
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[ARCH-R004]");
  });

  it("N12. legacy-import -> core is still outside its declared boundary (ARCH-R008)", () => {
    const r = runArchitecture("neg-legacy-import-core", (root) => {
      writeModule(
        root,
        "integrations/legacy-import",
        "src/main.ts",
        'import { core } from "@sestina/core";\nexport const Y = core;\n',
      );
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[ARCH-R008]");
  });

  it("N13. integrations/skills -> core is rejected as ARCH-R010", () => {
    const r = runArchitecture("neg-skills-core", (root) => {
      writeModule(
        root,
        "integrations/skills",
        "src/index.ts",
        'import { core } from "@sestina/core";\nexport const skill = core;\n',
      );
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[ARCH-R010]");
  });
});
