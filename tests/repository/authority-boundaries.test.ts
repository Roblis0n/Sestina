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
 *   AUTH-R005 the exact accepted product definition is present in every active region
 *   AUTH-R006 the stable current guidance chain exists and retains its contracts
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

const PRODUCT_DEFINITION =
  "Sestina 最终应当是一个本地交互式科研 App。其内部本体是 Research Deliberation Kernel，主要交互面是 Research Room；MCP、Skill、Hooks、CLI 只是外部宿主接入、自动化和恢复接口。Sestina 作为本地科研过程调试器，让 AI 始终围绕当前研究问题工作，记住已经作出的研究决定，识别目标替换、重复审计、论证跳跃和伪深度，并要求每一轮修改说明真正增加了什么。";

const GUIDANCE_FIXTURES: Record<string, string> = {
  "docs/product/CURRENT-PRODUCT-DEFINITION.md": [
    "accepted_current_authority",
    PRODUCT_DEFINITION,
    "用户是唯一研究权威",
  ].join("\n"),
  "docs/execution/CURRENT-PLAN.md": [
    "accepted_current_guide",
    "RI-43 为 `pilot_kit_ready_external_validation_deferred_by_user`",
    "RI-48 已完成决定驱动的 Local Research Room 垂直切片，状态为 `completed_and_verified_implementation_only`",
    "Market Gate 0",
  ].join("\n"),
  "docs/execution/CURRENT-PLAN-USAGE.md": [
    "required_operating_guide",
    "只有相邻一层能够授权下一层",
    "TASK-START-GATE.md",
  ].join("\n"),
  "docs/execution/TASK-START-GATE.md": [
    "required_before_every_task",
    "Gate A：方向成立",
    "final: ready_to_start | do_not_start",
  ].join("\n"),
};

/** The canonical active-authority marker block every entry must carry. */
function activeBlock(currentTask: string): string {
  return [
    "<!-- SESTINA_ACTIVE_AUTHORITY_START -->",
    "<!-- sestina-canonical-repo: D:\\Sestina -->",
    "<!-- sestina-direction: local-interactive-research-app -->",
    "<!-- sestina-product-invariant: local-interactive-research-app -->",
    "<!-- sestina-product-kernel: research-deliberation-kernel -->",
    "<!-- sestina-primary-interface: research-room -->",
    "<!-- sestina-external-interface-role: host-access-automation-recovery -->",
    "<!-- sestina-current-guide: docs/execution/CURRENT-PLAN.md -->",
    "<!-- sestina-plan-usage-guide: docs/execution/CURRENT-PLAN-USAGE.md -->",
    "<!-- sestina-task-start-gate: docs/execution/TASK-START-GATE.md -->",
    "<!-- sestina-guide-status: accepted_current -->",
    "<!-- sestina-prework-direction-gate: required -->",
    `<!-- sestina-current-task: ${currentTask} -->`,
    "<!-- sestina-next-code-goal: await_new_task_start_record_after_RI48 -->",
    "<!-- sestina-next-execution-goal: do_not_start_RI49_without_new_gate -->",
    "<!-- sestina-next-code-sequence: none_active_RI49_not_started -->",
    "<!-- sestina-ri44-to-ri47-status: superseded_unstarted -->",
    "<!-- sestina-ri48-status: completed_and_verified_implementation_only -->",
    "<!-- sestina-market-gate-0: deferred_by_user_nonblocking -->",
    "<!-- sestina-ri00: accepted_for_continuation -->",
    "<!-- sestina-ri01: deferred_by_current_user_for_direct_development -->",
    "<!-- sestina-ri02: deferred_by_current_user_for_direct_development -->",
    "<!-- sestina-old-task-11: not-current -->",
    "<!-- sestina-remote-visibility: private -->",
    "<!-- sestina-push-policy: commit-and-push-current-branch -->",
    PRODUCT_DEFINITION,
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

function writeGuidanceFiles(root: string): void {
  for (const [path, content] of Object.entries(GUIDANCE_FIXTURES)) {
    writeEntry(root, path, content);
  }
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
  writeGuidanceFiles(root);
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
      writeGuidanceFiles(root);
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
      writeGuidanceFiles(root);
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

  it("N9. missing exact product definition fails as AUTH-R005", () => {
    const r = runAuthority("neg-missing-invariant", (root) => {
      writeValidEntries(root, {
        "README.md": activeBlock("RI-03").replace(PRODUCT_DEFINITION, ""),
      });
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[AUTH-R005]");
    expect(r.stderr).toContain("README.md");
  });

  it("N10. changing one product-definition concept fails as AUTH-R005", () => {
    const r = runAuthority("neg-mutated-invariant", (root) => {
      writeValidEntries(root, {
        "CLAUDE.md": activeBlock("RI-03").replace("论证跳跃", "论证润色"),
      });
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[AUTH-R005]");
    expect(r.stderr).toContain("CLAUDE.md");
  });

  it("N11. product definition only in superseded history does not satisfy the active gate", () => {
    const r = runAuthority("neg-invariant-in-history", (root) => {
      writeValidEntries(root, {
        "AGENTS.md":
          activeBlock("RI-03").replace(PRODUCT_DEFINITION, "") +
          `\n<!-- SESTINA_SUPERSEDED_BASELINE_START -->\n${PRODUCT_DEFINITION}\n`,
      });
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[AUTH-R005]");
    expect(r.stderr).toContain("AGENTS.md");
  });

  it("N12. missing current guide fails as AUTH-R006", () => {
    const r = runAuthority("neg-missing-current-guide", (root) => {
      writeValidEntries(root);
      rmSync(join(root, "docs/execution/CURRENT-PLAN.md"));
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[AUTH-R006]");
    expect(r.stderr).toContain("docs/execution/CURRENT-PLAN.md");
  });

  it("N13. current guide losing the develop-first evidence boundary fails as AUTH-R006", () => {
    const r = runAuthority("neg-guide-loses-develop-first-boundary", (root) => {
      writeValidEntries(root);
      writeEntry(
        root,
        "docs/execution/CURRENT-PLAN.md",
        GUIDANCE_FIXTURES["docs/execution/CURRENT-PLAN.md"].replace(
          "RI-48 已完成决定驱动的 Local Research Room 垂直切片，状态为 `completed_and_verified_implementation_only`",
          "RI-48 is blocked",
        ),
      );
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[AUTH-R006]");
    expect(r.stderr).toContain("docs/execution/CURRENT-PLAN.md");
  });

  it("N14. active region presenting MCP as the product body fails as AUTH-R004", () => {
    const r = runAuthority("neg-mcp-product-body", (root) => {
      writeValidEntries(root);
      const abs = join(root, "README.md");
      const prior = readFileSync(abs, "utf8");
      writeFileSync(
        abs,
        prior.replace(
          "<!-- SESTINA_ACTIVE_AUTHORITY_END -->",
          "MCP 是产品本体。\n<!-- SESTINA_ACTIVE_AUTHORITY_END -->",
        ),
      );
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[AUTH-R004]");
  });

  it("N15. reverting completed RI-48 to planned-not-active in entry markers fails as AUTH-R002", () => {
    const r = runAuthority("neg-ri48-planned-not-active", (root) => {
      writeValidEntries(root, {
        "handoff.md": activeBlock("RI-03").replace(
          "sestina-ri48-status: completed_and_verified_implementation_only",
          "sestina-ri48-status: planned_not_active",
        ),
      });
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[AUTH-R002]");
    expect(r.stderr).toContain("sestina-ri48-status");
  });
});
