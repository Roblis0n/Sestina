#!/usr/bin/env node

/**
 * verify-authority.mjs
 *
 * Guards the ACTIVE authority regions of the repository entry documents so
 * stale product direction (old Task 11, RI-00 stop line, generic Agent OS,
 * CLI/MCP-first, or the superseded RI-43-before-RI-48 gate) cannot re-enter the entry
 * points as current guidance.
 *
 * Only the region between SESTINA_ACTIVE_AUTHORITY_START and
 * SESTINA_ACTIVE_AUTHORITY_END is scanned; everything after
 * SESTINA_SUPERSEDED_BASELINE_START is treated as history and ignored.
 *
 * Exit 0 on pass, exit 1 on any violation (errors to stderr).
 *
 * Usage: node scripts/verify-authority.mjs [--root <path>]
 *
 * Rule IDs (docs/architecture/01-DEPENDENCY-RULES.md):
 *   AUTH-R001 every entry file exists and carries an active region
 *   AUTH-R002 required markers present exactly once with valid values
 *   AUTH-R003 sestina-current-task agrees across entries and with the
 *             WORK-BOARD yaml current_task field
 *   AUTH-R004 no stale-authority phrasing inside active regions
 *   AUTH-R005 exact accepted product definition present in every active region
 *   AUTH-R006 current guidance chain exists and carries its defining contracts
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── CLI: parse --root ──
const ARGV = process.argv.slice(2);
let ROOT = null;
for (let i = 0; i < ARGV.length; i++) {
  if (ARGV[i] === "--root" && i + 1 < ARGV.length) {
    ROOT = resolve(ARGV[i + 1]);
    break;
  }
}
if (!ROOT) {
  ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

const ENTRY_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
  "handoff.md",
  "docs/execution/WORK-BOARD.md",
];

const ACTIVE_START = "<!-- SESTINA_ACTIVE_AUTHORITY_START -->";
const ACTIVE_END = "<!-- SESTINA_ACTIVE_AUTHORITY_END -->";
const PRODUCT_DEFINITION =
  "Sestina 最终应当是一个本地交互式科研 App。其内部本体是 Research Deliberation Kernel，主要交互面是 Research Room；MCP、Skill、Hooks、CLI 只是外部宿主接入、自动化和恢复接口。Sestina 作为本地科研过程调试器，让 AI 始终围绕当前研究问题工作，记住已经作出的研究决定，识别目标替换、重复审计、论证跳跃和伪深度，并要求每一轮修改说明真正增加了什么。";

const GUIDANCE_FILES = [
  {
    path: "docs/product/CURRENT-PRODUCT-DEFINITION.md",
    required: [
      "accepted_current_authority",
      PRODUCT_DEFINITION,
      "用户是唯一研究权威",
    ],
  },
  {
    path: "docs/execution/CURRENT-PLAN.md",
    required: [
      "accepted_current_guide",
      "RI-43 为 `pilot_kit_ready_external_validation_deferred_by_user`",
      "UI-01 Production App Shell",
      "completed_and_verified",
      "UI-02 Research Object Workspaces and Project Continuity",
      "RI-49 Correction Appeal and One Independent Second Opinion",
      "RI-49（已完成）",
      "当前没有活动编码任务",
      "none_active_RI50_not_started",
      "completed_and_verified_implementation_real_provider_evidence_blocked",
      "Market Gate 0",
    ],
  },
  {
    path: "docs/execution/CURRENT-PLAN-USAGE.md",
    required: [
      "required_operating_guide",
      "只有相邻一层能够授权下一层",
      "TASK-START-GATE.md",
    ],
  },
  {
    path: "docs/execution/TASK-START-GATE.md",
    required: [
      "required_before_every_task",
      "Gate A：方向成立",
      "final: ready_to_start | do_not_start",
    ],
  },
  {
    path: "docs/execution/RI-49-CORRECTION-APPEAL-AND-INDEPENDENT-SECOND-OPINION-TASK-START-RECORD.md",
    required: [
      "task: RI-49",
      "status: ready_to_start",
      "activity_status: active_correction_appeal_and_independent_second_opinion",
      "final: ready_to_start",
      "blocked_missing_user_config",
      "ri50_status: not_started",
    ],
  },
  {
    path: "docs/execution/RI-49-CORRECTION-APPEAL-AND-INDEPENDENT-SECOND-OPINION-TASK-RESULT.md",
    required: [
      "task: RI-49",
      "status: completed_and_verified",
      "pnpm_verify: passed",
      "next_code_task: none_active_RI50_not_started",
      "blocked_missing_user_config",
      "non_redundant_value_in_real_cases: unproven",
    ],
  },
  {
    path: "docs/execution/UI-02-RESEARCH-OBJECT-WORKSPACES-TASK-START-RECORD.md",
    required: [
      "task: UI-02",
      "status: ready_to_start",
      "activity_status: active_research_object_workspaces_and_project_continuity",
      "final: ready_to_start",
      "ri49_status: not_started",
      "blocked_missing_user_config",
    ],
  },
  {
    path: "docs/execution/UI-02-RESEARCH-OBJECT-WORKSPACES-TASK-RESULT.md",
    required: [
      "task: UI-02",
      "status: completed_and_verified",
      "pnpm_verify: passed",
      "ri49_status: not_started",
      "next_code_task: none_active_RI49_not_started",
      "blocked_missing_user_config",
    ],
  },
  {
    path: "docs/execution/UI-01-PRODUCTION-APP-SHELL-TASK-START-RECORD.md",
    required: [
      "task: UI-01",
      "status: ready_to_start",
      "final: ready_to_start",
      "ri49_status: not_started",
      "blocked_missing_user_config",
    ],
  },
  {
    path: "docs/execution/UI-01-PRODUCTION-APP-SHELL-TASK-RESULT.md",
    required: [
      "task: UI-01",
      "status: completed_and_verified",
      "pnpm_verify: passed",
      "ri49_status: not_started",
      "blocked_missing_user_config",
    ],
  },
  {
    path: "docs/execution/UI-01-PRODUCTION-STARTUP-CORRECTION-TASK-START-RECORD.md",
    required: [
      "task: UI-01",
      "slice: production_startup_packaging_correction",
      "status: ready_to_start",
      "final: ready_to_start",
      "ri49_status: not_started",
      "blocked_missing_user_config",
    ],
  },
  {
    path: "docs/execution/UI-01-PRODUCTION-STARTUP-CORRECTION-TASK-RESULT.md",
    required: [
      "task: UI-01",
      "slice: production_startup_packaging_correction",
      "status: completed_and_verified",
      "pnpm_verify: passed",
      "ri49_status: not_started",
      "blocked_missing_user_config",
    ],
  },
];

// ── Marker contract ──
// Each active region must carry every marker exactly once. Value checks:
//   - exact   : value must equal the canonical string
//   - pattern : value must match and must not match the banned pattern
const CANONICAL_REPO = "D:\\Sestina";
const MARKER_CONTRACT = {
  "sestina-canonical-repo": {
    exact: CANONICAL_REPO,
    why: "the sole canonical development repository is fixed by standing user decision",
  },
  "sestina-direction": {
    exact: "local-interactive-research-app",
    why: "Sestina's accepted final product form is a local interactive research App",
  },
  "sestina-product-invariant": {
    exact: "local-interactive-research-app",
    why: "the product invariant must identify the local interactive research App",
  },
  "sestina-product-kernel": {
    exact: "research-deliberation-kernel",
    why: "the Research Deliberation Kernel is the product body",
  },
  "sestina-primary-interface": {
    exact: "research-room",
    why: "the Research Room is the primary interaction surface",
  },
  "sestina-external-interface-role": {
    exact: "host-access-automation-recovery",
    why: "MCP, Skill, Hooks, and CLI are subordinate access, automation, and recovery interfaces",
  },
  "sestina-current-guide": {
    exact: "docs/execution/CURRENT-PLAN.md",
    why: "every entry must point to the accepted current guide",
  },
  "sestina-plan-usage-guide": {
    exact: "docs/execution/CURRENT-PLAN-USAGE.md",
    why: "every entry must point to the current plan usage guide",
  },
  "sestina-task-start-gate": {
    exact: "docs/execution/TASK-START-GATE.md",
    why: "every entry must require the current task-start gate",
  },
  "sestina-guide-status": {
    exact: "accepted_current",
    why: "the new guidance chain was explicitly accepted by the user",
  },
  "sestina-prework-direction-gate": {
    exact: "required",
    why: "every task must pass the product-direction gate before work begins",
  },
  "sestina-current-task": {
    pattern: /^(?:RI|UI)-\d+$/,
    why: "the current task id must be well formed and consistent across entries",
  },
  "sestina-current-status": {
    exact: "completed_and_verified",
    why: "RI-49 is the most recently completed and verified governed task",
  },
  "sestina-last-completed-task": {
    exact: "RI-49",
    why: "RI-49 is the most recently completed governed task",
  },
  "sestina-last-completed-status": {
    exact: "completed_and_verified",
    why: "the latest governed task passed its implementation and required host evidence gates",
  },
  "sestina-implementation-base": {
    exact: "579e50055f9fb7e84bf4aa272eb643d37c228895",
    why: "RI-49 was implemented from the recorded verified repository baseline",
  },
  "sestina-next-code-goal": {
    exact: "none_active_RI50_not_started",
    why: "RI-49 is complete and RI-50 has not been authorized",
  },
  "sestina-next-execution-goal": {
    exact: "await_explicit_user_authorization",
    why: "no subsequent product task is active",
  },
  "sestina-next-code-sequence": {
    exact: "none_active_RI50_not_started",
    why: "RI-50 remains not started and cannot be inferred from the route map",
  },
  "sestina-ri44-to-ri47-status": {
    exact: "superseded_unstarted",
    why: "old RI-44 through RI-47 were superseded without being implemented",
  },
  "sestina-ri48-status": {
    exact: "completed_and_verified_implementation_real_provider_evidence_blocked",
    why: "the RI-48 implementation is verified while real Provider evidence awaits explicit user configuration",
  },
  "sestina-market-gate-0": {
    exact: "deferred_by_user_nonblocking",
    why: "Market Gate 0 remains unrun but no longer blocks the explicitly authorized RI-48 implementation",
  },
  "sestina-ri00": {
    exact: "accepted_for_continuation",
    why: "RI-00 was accepted for continuation by the user",
  },
  "sestina-ri01": {
    pattern: /^(?!.*(complete|done|accepted))[\w.-]+$/,
    patternFlags: "i",
    why: "RI-01 is deferred and must never be presented as finished",
  },
  "sestina-ri02": {
    pattern: /^(?!.*(complete|done|accepted))[\w.-]+$/,
    patternFlags: "i",
    why: "RI-02 is deferred and must never be presented as finished",
  },
  "sestina-old-task-11": {
    pattern: /^(not-current|superseded)$/,
    why: "old Task 11 must stay marked as not current",
  },
  "sestina-remote-visibility": {
    exact: "private",
    why: "the GitHub repository must stay private",
  },
  "sestina-push-policy": {
    exact: "commit-and-push-current-branch",
    why: "file changes must be committed and pushed on the current branch",
  },
};

// Stale-authority phrasing banned inside ACTIVE regions (AUTH-R004).
const BANNED_ACTIVE_PHRASES = [
  { re: /next\s+task\s+11/i, label: "'next Task 11'" },
  { re: /task\s+11\s+is\s+next/i, label: "'Task 11 is next'" },
  { re: /当前唯一任务仍是\s*RI-00/, label: "naming RI-00 as the current unique task" },
  { re: /继续旧\s*Tasks/i, label: "resuming old Tasks 11-32" },
  { re: /Desktop\s*是首版控制面/, label: "Desktop as the first-version control plane" },
  {
    re: /Sestina\s*是一个本地科研过程调试器。/,
    label: "the former debugger-only product definition",
  },
  {
    re: /(MCP|CLI|Skill|Hooks)[^\n]{0,40}(产品本体|主要交互面)/i,
    label: "a subordinate interface presented as the product body or primary surface",
  },
  {
    re: /通用\s*Agent\s*OS[^\n]{0,40}产品本体/,
    label: "generic Agent OS as the product body",
  },
];

// ── Helpers ──
let errors = 0;

function err(msg) {
  process.stderr.write(`[FAIL] ${msg}\n`);
  errors += 1;
}

function ok(msg) {
  process.stderr.write(`[OK]   ${msg}\n`);
}

function extractActiveRegion(text) {
  const start = text.indexOf(ACTIVE_START);
  const end = text.indexOf(ACTIVE_END);
  if (start === -1 || end === -1 || end < start) return null;
  return text.slice(start + ACTIVE_START.length, end);
}

// ── Check entries ──
const currentTasks = new Map(); // entry -> task id
const markerRe = /<!--\s*(sestina-[\w-]+)\s*:\s*([^<\n]*?)\s*-->/g;

for (const entry of ENTRY_FILES) {
  const abs = resolve(ROOT, entry);
  if (!existsSync(abs)) {
    err(`[AUTH-R001] ${entry}: active entry file is missing`);
    continue;
  }
  const text = readFileSync(abs, "utf8");
  const region = extractActiveRegion(text);
  if (region === null) {
    err(
      `[AUTH-R001] ${entry}: no active authority region; wrap current guidance in ${ACTIVE_START} ... ${ACTIVE_END}`,
    );
    continue;
  }

  // AUTH-R002: marker presence, uniqueness, values.
  const seen = new Map();
  let m;
  markerRe.lastIndex = 0;
  while ((m = markerRe.exec(region)) !== null) {
    seen.set(m[1], [...(seen.get(m[1]) ?? []), m[2]]);
  }
  for (const [marker, contract] of Object.entries(MARKER_CONTRACT)) {
    const values = seen.get(marker);
    if (values === undefined) {
      err(
        `[AUTH-R002] ${entry}: active region is missing the '${marker}' marker (${contract.why})`,
      );
      continue;
    }
    if (values.length > 1) {
      err(
        `[AUTH-R002] ${entry}: marker '${marker}' appears ${values.length} times; exactly one is required`,
      );
      continue;
    }
    const value = values[0];
    let valid;
    if (contract.exact !== undefined) {
      valid = value === contract.exact;
    } else {
      let re = contract.pattern;
      if (contract.patternFlags) {
        re = new RegExp(re.source, re.flags + contract.patternFlags);
      }
      valid = re.test(value);
    }
    if (!valid) {
      err(
        `[AUTH-R002] ${entry}: marker '${marker}' has invalid value '${value}' (${contract.why})`,
      );
    } else if (marker === "sestina-current-task") {
      currentTasks.set(entry, value);
    }
  }

  // AUTH-R004: stale phrasing banned in the active region only.
  for (const { re, label } of BANNED_ACTIVE_PHRASES) {
    if (re.test(region)) {
      err(
        `[AUTH-R004] ${entry}: active region contains stale authority phrasing (${label}); move it below SESTINA_SUPERSEDED_BASELINE_START or remove it`,
      );
    }
  }

  // AUTH-R005: the user's accepted product definition is immutable and active.
  const definitionOccurrences = region.split(PRODUCT_DEFINITION).length - 1;
  if (definitionOccurrences !== 1) {
    err(
      `[AUTH-R005] ${entry}: active region must contain the exact accepted product definition once; found ${definitionOccurrences}`,
    );
  }
  ok(`${entry}: active authority region checked`);
}

// AUTH-R003: current-task agreement, including the WORK-BOARD yaml field.
const tasks = [...currentTasks.entries()];
if (tasks.length > 0) {
  const first = tasks[0][1];
  if (first !== "RI-49") {
    err(
      `[AUTH-R003] ${tasks[0][0]}: current task is '${first}' but the latest governed task is 'RI-49'`,
    );
  }
  for (const [entry, task] of tasks) {
    if (task !== first) {
      err(
        `[AUTH-R003] ${entry}: sestina-current-task is '${task}' but ${tasks[0][0]} says '${first}'; every entry must name the same current task`,
      );
    }
  }
  const boardPath = resolve(ROOT, "docs/execution/WORK-BOARD.md");
  if (existsSync(boardPath)) {
    const board = readFileSync(boardPath, "utf8");
    const region = extractActiveRegion(board) ?? "";
    const yaml = board.match(/current_task:\s*([^\s\n`]+)/);
    if (yaml) {
      const boardTask = yaml[1];
      const markerTask = currentTasks.get("docs/execution/WORK-BOARD.md");
      if (markerTask && boardTask !== markerTask) {
        err(
          `[AUTH-R003] docs/execution/WORK-BOARD.md: yaml current_task is '${boardTask}' but the active marker says '${markerTask}'; keep them in sync`,
        );
      }
      if (boardTask !== first) {
        err(
          `[AUTH-R003] docs/execution/WORK-BOARD.md: yaml current_task is '${boardTask}' but other entries say '${first}'`,
        );
      }
    }
  }
} else if (errors === 0) {
  err("[AUTH-R003] no entry carries a valid sestina-current-task marker");
}

// AUTH-R006: the stable current guidance chain must exist and retain its
// defining contracts. Entry markers alone are not enough if a target file was
// deleted, renamed, or silently rewritten into a different product direction.
for (const guidance of GUIDANCE_FILES) {
  const abs = resolve(ROOT, guidance.path);
  if (!existsSync(abs)) {
    err(`[AUTH-R006] ${guidance.path}: required current guidance file is missing`);
    continue;
  }
  const text = readFileSync(abs, "utf8");
  for (const required of guidance.required) {
    if (!text.includes(required)) {
      err(
        `[AUTH-R006] ${guidance.path}: required guidance contract is missing: '${required}'`,
      );
    }
  }
  ok(`${guidance.path}: current guidance contract checked`);
}

if (errors > 0) {
  process.stderr.write(`\n[RESULT] ${errors} authority violation(s) found\n`);
  process.exit(1);
}
process.stderr.write(`[RESULT] All active authority checks passed\n`);
process.exit(0);
