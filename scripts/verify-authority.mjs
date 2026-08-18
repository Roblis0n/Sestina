#!/usr/bin/env node

/**
 * verify-authority.mjs
 *
 * Guards the ACTIVE authority regions of the repository entry documents so
 * stale product direction (old Task 11, RI-00 stop line, Desktop-first,
 * generic Agent OS) cannot re-enter the entry points as current guidance.
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
 *   AUTH-R005 exact product invariant present in every active region
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
const PRODUCT_INVARIANT =
  "Sestina 是一个本地科研过程调试器。它让 AI 始终围绕当前研究问题工作，记住已经作出的研究决定，识别目标替换、重复审计、论证跳跃和伪深度，并要求每一轮修改说明真正增加了什么。";

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
    exact: "local-research-process-debugger",
    why: "Sestina is a local research process debugger",
  },
  "sestina-product-invariant": {
    exact: "local-research-process-debugger",
    why: "the product invariant must identify the local research process debugger",
  },
  "sestina-prework-direction-gate": {
    exact: "required",
    why: "every task must pass the product-direction gate before work begins",
  },
  "sestina-current-task": {
    pattern: /^RI-\d+$/,
    why: "the current task id must be a well-formed RI-XX id consistent across entries",
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

  // AUTH-R005: the user's product definition is immutable and active.
  const invariantOccurrences = region.split(PRODUCT_INVARIANT).length - 1;
  if (invariantOccurrences !== 1) {
    err(
      `[AUTH-R005] ${entry}: active region must contain the exact product invariant once; found ${invariantOccurrences}`,
    );
  }
  ok(`${entry}: active authority region checked`);
}

// AUTH-R003: current-task agreement, including the WORK-BOARD yaml field.
const tasks = [...currentTasks.entries()];
if (tasks.length > 0) {
  const first = tasks[0][1];
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

if (errors > 0) {
  process.stderr.write(`\n[RESULT] ${errors} authority violation(s) found\n`);
  process.exit(1);
}
process.stderr.write(`[RESULT] All active authority checks passed\n`);
process.exit(0);
