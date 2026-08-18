/**
 * Negative/positive fixture tests for verify-authority.mjs.
 *
 * Each test builds a fixture repository whose active entry files
 * (AGENTS.md, CLAUDE.md, README.md, handoff.md, docs/execution/WORK-BOARD.md)
 * carry machine-readable authority markers, runs the verifier via spawnSync,
 * and asserts exit codes and AUTH rule IDs.
 *
 * Rule IDs (docs/architecture/01-DEPENDENCY-RULES.md):
 *   AUTH-R001 every entry file exists and has an active authority region
 *   AUTH-R002 every required marker is present exactly once with a valid value
 *   AUTH-R003 sestina-current-task agrees across entries and with the
 *             WORK-BOARD current_task field
 *   AUTH-R004 no stale-authority phrasing inside active regions (text after
 *             SESTINA_SUPERSEDED_BASELINE_START is history and is ignored)
 *   AUTH-R005 the exact product invariant is present in every active region
 */
import { describe, it, expect } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdtempSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const SCRIPT_DIR = resolve(import.meta.dirname, "..", "..");
const AUTH_SCRIPT = resolve(SCRIPT_DIR, "scripts", "verify-authority.mjs");
const NODE = process.execPath;

const ENTRY_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
  "handoff.md",
  "docs/execution/WORK-BOARD.md",
];

const PRODUCT_INVARIANT =
  "Sestina 是一个本地科研过程调试器。它让 AI 始终围绕当前研究问题工作，记住已经作出的研究决定，识别目标替换、重复审计、论证跳跃和伪深度，并要求每一轮修改说明真正增加了什么。";

/** The canonical active-authority marker block every entry must carry. */
function activeBlock(currentTask: string): string {
  return [
    "<!-- SESTINA_ACTIVE_AUTHORITY_START -->",
    "<!-- sestina-canonical-repo: D:\\Sestina -->",
    "<!-- sestina-direction: local-research-process-debugger -->",
    "<!-- sestina-product-invariant: local-research-process-debugger -->",
    "<!-- sestina-prework-direction-gate: required -->",
    `<!-- sestina-current-task: ${currentTask} -->`,
    "<!-- sestina-ri00: accepted_for_continuation -->",
    "<!-- sestina-ri01: deferred_by_current_user_for_direct_development -->",
    "<!-- sestina-ri02: deferred_by_current_user_for_direct_development -->",
    "<!-- sestina-old-task-11: not-current -->",
    "<!-- sestina-remote-visibility: private -->",
    "<!-- sestina-push-policy: commit-and-push-current-branch -->",
    PRODUCT_INVARIANT,
    "<!-- SESTINA_ACTIVE_AUTHORITY_END -->",
  ].join("\n");
}

/** WORK-BOARD body with a yaml current_task that must agree with markers. */
function workBoardBody(currentTask: string): string {
  return `\n\n\`\`\`yaml\ncurrent_task: ${currentTask}\nstatus: awaiting_user_acceptance\n\`\`\`\n`;
}

function writeEntry(root: string, relFile: string, content: string): void {
  const abs = join(root, relFile);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function runAuthority(
  fixtureName: string,
  setup: (root: string) => void,
): { exitCode: number; stderr: string } {
  const root = mkdtempSync(join(tmpdir(), `sestina-auth-${fixtureName}-`));
  try {
    setup(root);
    const result = spawnSync(NODE, [AUTH_SCRIPT, "--root", root], {
      encoding: "utf8",
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

/** Fixture where every entry carries the canonical active block. */
function writeValidEntries(
  root: string,
  overrides: Partial<Record<string, string>> = {},
): void {
  for (const entry of ENTRY_FILES) {
    const isBoard = entry === "docs/execution/WORK-BOARD.md";
    const task = "RI-03";
    const body = isBoard
      ? workBoardBody(task)
      : "\n\nLegacy prose stays below.\n";
    writeEntry(root, entry, (overrides[entry] ?? activeBlock(task)) + body);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Positive fixtures
// ═══════════════════════════════════════════════════════════════════════════

describe("verify-authority positive fixtures", () => {
  it("P1. canonical active authority entries pass", () => {
    const r = runAuthority("pos-valid", (root) => {
      writeValidEntries(root);
    });
    expect(r.exitCode).toBe(0);
  });

  it("P2. stale phrasing inside the superseded history region is ignored", () => {
    const r = runAuthority("pos-superseded", (root) => {
      writeValidEntries(root);
      for (const entry of ENTRY_FILES) {
        const abs = join(root, entry);
        const prior = readFileSync(abs, "utf8");
        writeFileSync(
          abs,
          prior +
            "\n<!-- SESTINA_SUPERSEDED_BASELINE_START -->\nNext Task 11 is the current plan; the current unique task is still RI-00.\n",
        );
      }
    });
    expect(r.exitCode).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Negative fixtures
// ═══════════════════════════════════════════════════════════════════════════

describe("verify-authority negative fixtures", () => {
  it("N1. active region claiming 'next Task 11' fails as AUTH-R004", () => {
    const r = runAuthority("neg-task11", (root) => {
      writeValidEntries(root);
      const abs = join(root, "handoff.md");
      const prior = readFileSync(abs, "utf8");
      writeFileSync(
        abs,
        prior.replace(
          "<!-- SESTINA_ACTIVE_AUTHORITY_END -->",
          "Next Task 11 is what we implement now.\n<!-- SESTINA_ACTIVE_AUTHORITY_END -->",
        ),
      );
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[AUTH-R004]");
    expect(r.stderr).toContain("handoff.md");
  });

  it("N2. active region still naming RI-00 as the current unique task fails", () => {
    const r = runAuthority("neg-ri00-current", (root) => {
      writeValidEntries(root);
      const abs = join(root, "AGENTS.md");
      const prior = readFileSync(abs, "utf8");
      writeFileSync(
        abs,
        prior.replace(
          "<!-- SESTINA_ACTIVE_AUTHORITY_END -->",
          "当前唯一任务仍是 RI-00。\n<!-- SESTINA_ACTIVE_AUTHORITY_END -->",
        ),
      );
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[AUTH-R004]");
  });

  it("N3. inconsistent current-task markers across entries fail as AUTH-R003", () => {
    const r = runAuthority("neg-task-mismatch", (root) => {
      writeValidEntries(root, {
        "CLAUDE.md": activeBlock("RI-04"),
      });
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[AUTH-R003]");
  });

  it("N4. WORK-BOARD yaml current_task disagreeing with markers fails", () => {
    const r = runAuthority("neg-board-mismatch", (root) => {
      for (const entry of ENTRY_FILES) {
        const isBoard = entry === "docs/execution/WORK-BOARD.md";
        const body = isBoard
          ? workBoardBody("RI-09")
          : "\n\nLegacy prose stays below.\n";
        writeEntry(root, entry, activeBlock("RI-03") + body);
      }
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[AUTH-R003]");
  });

  it("N5. missing WORK-BOARD fails as AUTH-R001", () => {
    const r = runAuthority("neg-no-board", (root) => {
      for (const entry of ENTRY_FILES) {
        if (entry === "docs/execution/WORK-BOARD.md") continue;
        writeEntry(root, entry, activeBlock("RI-03") + "\n");
      }
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[AUTH-R001]");
  });

  it("N6. entry without an active authority region fails as AUTH-R001", () => {
    const r = runAuthority("neg-no-region", (root) => {
      writeValidEntries(root);
      writeEntry(root, "README.md", "# Sestina\n\nNo markers at all.\n");
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[AUTH-R001]");
  });

  it("N7. active region missing the RI-00 marker fails as AUTH-R002", () => {
    const r = runAuthority("neg-missing-marker", (root) => {
      writeValidEntries(root, {
        "CLAUDE.md": activeBlock("RI-03").replace(
          /<!-- sestina-ri00:[^\n]*-->\n/,
          "",
        ),
      });
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[AUTH-R002]");
  });

  it("N8. marker claiming RI-01 already finished fails as AUTH-R002", () => {
    const r = runAuthority("neg-ri01-done", (root) => {
      writeValidEntries(root, {
        "handoff.md": activeBlock("RI-03").replace(
          "sestina-ri01: deferred_by_current_user_for_direct_development",
          "sestina-ri01: completed",
        ),
      });
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[AUTH-R002]");
  });

  it("N9. missing exact product invariant fails as AUTH-R005", () => {
    const r = runAuthority("neg-missing-invariant", (root) => {
      writeValidEntries(root, {
        "README.md": activeBlock("RI-03").replace(PRODUCT_INVARIANT, ""),
      });
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[AUTH-R005]");
    expect(r.stderr).toContain("README.md");
  });

  it("N10. changing one product-invariant concept fails as AUTH-R005", () => {
    const r = runAuthority("neg-mutated-invariant", (root) => {
      writeValidEntries(root, {
        "CLAUDE.md": activeBlock("RI-03").replace("论证跳跃", "论证润色"),
      });
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[AUTH-R005]");
    expect(r.stderr).toContain("CLAUDE.md");
  });

  it("N11. invariant only in superseded history does not satisfy the active gate", () => {
    const r = runAuthority("neg-invariant-in-history", (root) => {
      writeValidEntries(root, {
        "AGENTS.md":
          activeBlock("RI-03").replace(PRODUCT_INVARIANT, "") +
          `\n<!-- SESTINA_SUPERSEDED_BASELINE_START -->\n${PRODUCT_INVARIANT}\n`,
      });
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[AUTH-R005]");
    expect(r.stderr).toContain("AGENTS.md");
  });
});
