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
const CURRENT_STATUS = "ready_to_start";

const GUIDANCE_FIXTURES: Record<string, string> = {
  "docs/product/CURRENT-PRODUCT-DEFINITION.md": [
    "accepted_current_authority",
    PRODUCT_DEFINITION,
    "用户是唯一研究权威",
  ].join("\n"),
  "docs/execution/CURRENT-PLAN.md": [
    "accepted_current_guide",
    "RI-43 为 `pilot_kit_ready_external_validation_deferred_by_user`",
    "UI-01 Production App Shell",
    "completed_and_verified",
    "UI-02 Research Object Workspaces and Project Continuity",
    "RI-49 Correction Appeal and One Independent Second Opinion",
    "RI-49（已完成）",
    "RI-50 Mutually Blind, Bounded Two-Participant Deliberation Room",
    "RI-50（已完成）",
    "UI-03 Production Experience Quality Consolidation and Functional Cohesion",
    "UI-03 已按 Task Start/Result 完成并验证",
    "RI-51 Project-level Minimal Governed Working Memory and Recovery Continuity",
    "RI-51 已完成并验证",
    "RI-52 Closed External App Pilot",
    "RI-52（已完成）",
    "RI-53 Research Room Release Resilience",
    "research_room_release_resilience",
    "completed_and_verified_implementation_real_provider_evidence_blocked",
    "Market Gate 0",
  ].join("\n"),
  "docs/execution/CURRENT-PLAN-USAGE.md": [
    "required_operating_guide",
    "只有相邻一层能够授权下一层",
    "TASK-START-GATE.md",
  ].join("\n"),
  "docs/execution/RI-52-CLOSED-EXTERNAL-APP-PILOT-TASK-START-RECORD.md": [
    "task: RI-52",
    "status: ready_to_start",
    "gate_conclusion: ready_to_start_user_authorized_development",
    "activity_status: active_closed_external_app_pilot",
    "implementation_authorization: explicit_user_authorization_2026_08_28",
    "next_code_goal: closed_external_app_pilot",
    "target_host: codex",
    "public_mcp_write_capability: prohibited",
    "host_authority_mutation: prohibited",
    "automatic_retry: prohibited",
    "production_visual_and_functional_acceptance: required",
    "ri53_status: not_started",
    "final: ready_to_start",
  ].join("\n"),
  "docs/execution/RI-52-CLOSED-EXTERNAL-APP-PILOT-TASK-RESULT.md": [
    "task: RI-52",
    "status: completed_and_verified",
    "schema: 20",
    "production_visual_and_functional_acceptance: passed",
    "context_preview_actual_payload_match: passed",
    "public_mcp_write_capability: absent",
    "host_authority_mutation: zero_verified",
    "cross_project_leakage: zero_verified",
    "automatic_retry: zero_verified",
    "candidate_authority: model_proposed_only",
    "real_codex_candidate_session: passed",
    "real_codex_continuity_new_host_session: passed",
    "real_codex_evidence_composition: prior_real_candidate_plus_new_real_fresh_session_continuity",
    "next_code_goal: none_active_RI53_not_started",
    "ri53_status: not_started",
  ].join("\n"),
  "docs/execution/RI-52-PRODUCTION-VISUAL-AND-FUNCTIONAL-ACCEPTANCE.md": [
    "task: RI-52",
    "production_visual_and_functional_acceptance: passed",
    "browser_automation: 3_of_3_passed",
    "final_images_generated_and_opened: 18",
    "blocker_remaining: 0",
    "major_remaining: 0",
    "in_scope_moderate_remaining: 0",
    "real_codex_continuity_evidence: passed_by_separate_continuity_only_host_observation",
  ].join("\n"),
  "docs/execution/RI-53-RELEASE-RESILIENCE-SECURITY-RECOVERY-UPGRADE-COMPATIBILITY-TASK-START-RECORD.md": [
    "task: RI-53",
    "status: ready_to_start",
    "gate_conclusion: ready_to_start_user_authorized_development",
    "activity_status: active_release_resilience_security_recovery_upgrade_compatibility",
    "implementation_authorization: explicit_user_authorization_2026_08_28",
    "next_code_goal: research_room_release_resilience",
    "production_visual_and_functional_acceptance: required",
    "ri52_status: completed_and_verified",
    "ri54_status: not_started",
    "final: ready_to_start",
  ].join("\n"),
  "docs/execution/TASK-START-GATE.md": [
    "required_before_every_task",
    "Gate A：方向成立",
    "final: ready_to_start | do_not_start",
  ].join("\n"),
  "docs/execution/UI-03-PRODUCTION-EXPERIENCE-QUALITY-CONSOLIDATION-TASK-START-RECORD.md": [
    "task: UI-03",
    "status: ready_to_start",
    "activity_status: active_production_experience_quality_consolidation_and_functional_cohesion",
    "implementation_authorization: explicit_user_authorization_2026_08_27",
    "production_visual_and_functional_acceptance: required",
    "next_code_goal: production_experience_quality_consolidation_and_functional_cohesion",
    "ri51_status: not_started",
    "final: ready_to_start",
  ].join("\n"),
  "docs/execution/UI-03-PRODUCTION-EXPERIENCE-QUALITY-CONSOLIDATION-TASK-RESULT.md": [
    "task: UI-03",
    "status: completed_and_verified",
    "pnpm_verify: passed",
    "production_browser_e2e: passed",
    "production_visual_and_functional_acceptance: passed",
    "screens_opened_and_inspected: 43",
    "kernel_boundary: unchanged_and_verified",
    "user_authority: unchanged_and_verified",
    "manifest_boundary: unchanged_and_verified",
    "provider_boundary: unchanged_and_verified",
    "receipt_boundary: unchanged_and_verified",
    "real_two_provider_smoke: blocked_missing_user_config",
    "mutual_cognitive_independence: unproven",
    "repeatable_non_redundant_value_in_real_cases: unproven",
    "external_user_value: unproven",
    "ri51_status: not_started",
    "next_code_goal: none_active_RI51_not_started",
    "next_execution_goal: await_explicit_user_authorization",
    "remote_visibility: PRIVATE",
  ].join("\n"),
  "docs/execution/UI-03-PRODUCTION-VISUAL-ACCEPTANCE-RECORD.md": [
    "task: UI-03",
    "status: passed",
    "production_route: real_research_room",
    "browser: microsoft_edge",
    "typed_api_facade: used",
    "runtime_decoder: used",
    "core_projection: used",
    "screens_opened_and_inspected: 43",
    "blockers_remaining: 0",
    "majors_remaining: 0",
    "in_scope_moderates_remaining: 0",
  ].join("\n"),
  "docs/execution/RI-51-PROJECT-LEVEL-MINIMAL-GOVERNED-MEMORY-AND-RECOVERY-CONTINUITY-TASK-START-RECORD.md": [
    "task: RI-51",
    "status: ready_to_start",
    "gate_conclusion: ready_to_start_user_authorized_development",
    "activity_status: active_project_level_minimum_governed_memory_and_recovery_continuity",
    "implementation_authorization: explicit_user_authorization_2026_08_27",
    "next_code_goal: project_level_minimum_governed_memory_and_recovery_continuity",
    "real_second_use_value: unproven",
    "cross_project_memory: prohibited",
    "automatic_memory_promotion: prohibited",
    "default_external_memory_send: prohibited",
    "production_visual_and_functional_acceptance: required",
    "ri52_status: not_started",
    "final: ready_to_start",
  ].join("\n"),
  "docs/execution/RI-51-PROJECT-LEVEL-MINIMAL-GOVERNED-MEMORY-AND-RECOVERY-CONTINUITY-TASK-RESULT.md": [
    "task: RI-51",
    "status: completed_and_verified",
    "pnpm_verify: passed",
    "production_browser_e2e: passed",
    "production_visual_and_functional_acceptance: passed",
    "screens_opened_and_inspected: 12",
    "governed_project_memory_implementation: passed",
    "cross_project_memory_leakage: zero_verified",
    "automatic_memory_promotion: zero_verified",
    "default_external_memory_send: zero_verified",
    "real_provider_smoke: blocked_missing_user_config",
    "real_second_use_recovery_value: unproven",
    "next_code_task: none_active_RI52_not_started",
    "next_execution_goal: await_explicit_user_authorization",
    "ri52_status: not_started",
    "remote_visibility: PRIVATE",
  ].join("\n"),
  "docs/execution/RI-51-PRODUCTION-VISUAL-AND-FUNCTIONAL-ACCEPTANCE.md": [
    "task: RI-51",
    "status: passed",
    "production_route: real_research_room",
    "browser: microsoft_edge",
    "typed_api_facade: used",
    "runtime_decoder: used",
    "core_projection: used",
    "screens_opened_and_inspected: 12",
    "blockers_remaining: 0",
    "majors_remaining: 0",
    "in_scope_moderates_remaining: 0",
    "production_visual_and_functional_acceptance: passed",
  ].join("\n"),
  "docs/architecture/05-PROJECT-LEVEL-GOVERNED-WORKING-MEMORY.md": [
    "Status: `implemented_and_verified`",
    "working_memory_non_authoritative",
    "Project Authority State != Project Working Memory",
    "Default zero",
    "real Provider smoke remains `blocked_missing_user_config`",
  ].join("\n"),
  "docs/migrations/RI-51-SCHEMA-019.md": [
    "Status: `implemented_and_verified`",
    "019-project-working-memory",
    "project_working_memory",
    "resume_checkpoints",
    "does not persist request-scoped Context Manifests",
  ].join("\n"),
  "docs/execution/RI-50-MUTUALLY-BLIND-BOUNDED-DELIBERATION-ROOM-TASK-START-RECORD.md": [
    "task: RI-50",
    "status: ready_to_start",
    "activity_status: active_mutually_blind_bounded_deliberation_room",
    "implementation_authorization: explicit_user_authorization_2026_08_26",
    "final: ready_to_start",
    "real_second_opinion_provider_smoke: blocked_missing_user_config",
    "ri50_real_value_gate: unproven_nonblocking_for_implementation",
    "ri51_status: not_started",
  ].join("\n"),
  "docs/execution/RI-50-MUTUALLY-BLIND-BOUNDED-DELIBERATION-ROOM-TASK-RESULT.md": [
    "task: RI-50",
    "status: completed_and_verified",
    "pnpm_verify: passed",
    "blind_parallel_protocol: passed_with_loopback_and_fixtures",
    "bounded_rounds: passed",
    "user_authority: passed",
    "production_visual_verification: passed",
    "real_two_provider_deliberation_smoke: blocked_missing_user_config",
    "mutual_cognitive_independence: unproven",
    "repeatable_non_redundant_value_in_real_cases: unproven",
    "external_user_value: unproven",
    "next_code_goal: none_active_RI51_not_started",
  ].join("\n"),
  "docs/execution/RI-49-CORRECTION-APPEAL-AND-INDEPENDENT-SECOND-OPINION-TASK-START-RECORD.md": [
    "task: RI-49",
    "status: ready_to_start",
    "activity_status: active_correction_appeal_and_independent_second_opinion",
    "final: ready_to_start",
    "blocked_missing_user_config",
    "ri50_status: not_started",
  ].join("\n"),
  "docs/execution/RI-49-CORRECTION-APPEAL-AND-INDEPENDENT-SECOND-OPINION-TASK-RESULT.md": [
    "task: RI-49",
    "status: completed_and_verified",
    "pnpm_verify: passed",
    "next_code_task: none_active_RI50_not_started",
    "blocked_missing_user_config",
    "non_redundant_value_in_real_cases: unproven",
  ].join("\n"),
  "docs/execution/UI-02-RESEARCH-OBJECT-WORKSPACES-TASK-START-RECORD.md": [
    "task: UI-02",
    "status: ready_to_start",
    "activity_status: active_research_object_workspaces_and_project_continuity",
    "final: ready_to_start",
    "ri49_status: not_started",
    "blocked_missing_user_config",
  ].join("\n"),
  "docs/execution/UI-02-RESEARCH-OBJECT-WORKSPACES-TASK-RESULT.md": [
    "task: UI-02",
    "status: completed_and_verified",
    "pnpm_verify: passed",
    "ri49_status: not_started",
    "next_code_task: none_active_RI49_not_started",
    "blocked_missing_user_config",
  ].join("\n"),
  "docs/execution/UI-01-PRODUCTION-APP-SHELL-TASK-START-RECORD.md": [
    "task: UI-01",
    "status: ready_to_start",
    "final: ready_to_start",
    "ri49_status: not_started",
    "blocked_missing_user_config",
  ].join("\n"),
  "docs/execution/UI-01-PRODUCTION-APP-SHELL-TASK-RESULT.md": [
    "task: UI-01",
    "status: completed_and_verified",
    "pnpm_verify: passed",
    "ri49_status: not_started",
    "blocked_missing_user_config",
  ].join("\n"),
  "docs/execution/UI-01-PRODUCTION-STARTUP-CORRECTION-TASK-START-RECORD.md": [
    "task: UI-01",
    "slice: production_startup_packaging_correction",
    "status: ready_to_start",
    "final: ready_to_start",
    "ri49_status: not_started",
    "blocked_missing_user_config",
  ].join("\n"),
  "docs/execution/UI-01-PRODUCTION-STARTUP-CORRECTION-TASK-RESULT.md": [
    "task: UI-01",
    "slice: production_startup_packaging_correction",
    "status: completed_and_verified",
    "pnpm_verify: passed",
    "ri49_status: not_started",
    "blocked_missing_user_config",
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
    `<!-- sestina-current-status: ${CURRENT_STATUS} -->`,
    "<!-- sestina-last-completed-task: RI-52 -->",
    "<!-- sestina-last-completed-status: completed_and_verified -->",
    "<!-- sestina-implementation-base: d92fa8c196e00b8adfe3cbd4791ed4032dfad85c -->",
    "<!-- sestina-next-code-goal: research_room_release_resilience -->",
    "<!-- sestina-next-execution-goal: implement_RI53_release_resilience -->",
    "<!-- sestina-next-code-sequence: research_room_release_resilience -->",
    "<!-- sestina-production-visual-and-functional-acceptance: required -->",
    "<!-- sestina-ri51-status: completed_and_verified -->",
    "<!-- sestina-ri52-status: completed_and_verified -->",
    "<!-- sestina-ri53-status: ready_to_start -->",
    "<!-- sestina-ri54-status: not_started -->",
    "<!-- sestina-ri52-target-host: codex -->",
    "<!-- sestina-ri52-closed-host-pilot: passed -->",
    "<!-- sestina-ri52-public-mcp-write-capability: absent -->",
    "<!-- sestina-ri52-host-authority-mutation: zero_verified -->",
    "<!-- sestina-ri52-cross-project-leakage: zero_verified -->",
    "<!-- sestina-ri52-automatic-retry: zero_verified -->",
    "<!-- sestina-ri52-context-preview-actual-payload-match: passed -->",
    "<!-- sestina-ri52-candidate-authority: model_proposed_only -->",
    "<!-- sestina-ri52-real-codex-candidate-session: passed -->",
    "<!-- sestina-ri52-real-codex-continuity-new-host-session: passed -->",
    "<!-- sestina-ri52-production-visual-and-functional-acceptance: passed -->",
    "<!-- sestina-governed-project-memory-implementation: passed -->",
    "<!-- sestina-cross-project-memory-leakage: zero_verified -->",
    "<!-- sestina-automatic-memory-promotion: zero_verified -->",
    "<!-- sestina-default-external-memory-send: zero_verified -->",
    "<!-- sestina-real-second-use-recovery-value: unproven -->",
    "<!-- sestina-ri44-to-ri47-status: superseded_unstarted -->",
    "<!-- sestina-ri48-status: completed_and_verified_implementation_real_provider_evidence_blocked -->",
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
  return `\n\n\`\`\`yaml\ncurrent_task: ${currentTask}\nstatus: ${CURRENT_STATUS}\n\`\`\`\n`;
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
    const task = "RI-53";
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

  it("P3. the checked-in authority activates the user-authorized RI-53 release-resilience boundary", () => {
    const expected = [
      "<!-- sestina-current-task: RI-53 -->",
      "<!-- sestina-current-status: ready_to_start -->",
      "<!-- sestina-last-completed-task: RI-52 -->",
      "<!-- sestina-next-code-goal: research_room_release_resilience -->",
      "<!-- sestina-next-execution-goal: implement_RI53_release_resilience -->",
      "<!-- sestina-production-visual-and-functional-acceptance: required -->",
      "<!-- sestina-ri51-status: completed_and_verified -->",
      "<!-- sestina-ri52-status: completed_and_verified -->",
      "<!-- sestina-ri52-real-codex-candidate-session: passed -->",
      "<!-- sestina-ri52-real-codex-continuity-new-host-session: passed -->",
      "<!-- sestina-ri53-status: ready_to_start -->",
      "<!-- sestina-ri54-status: not_started -->",
    ];

    for (const entry of ENTRY_FILES) {
      const contents = readFileSync(resolve(SCRIPT_DIR, entry), "utf8");
      for (const marker of expected) {
        expect(contents, `${entry} must contain ${marker}`).toContain(marker);
      }
    }

    const taskStart = readFileSync(
      resolve(
        SCRIPT_DIR,
        "docs/execution/RI-53-RELEASE-RESILIENCE-SECURITY-RECOVERY-UPGRADE-COMPATIBILITY-TASK-START-RECORD.md",
      ),
      "utf8",
    );
    expect(taskStart).toContain("task: RI-53");
    expect(taskStart).toContain("status: ready_to_start");
    expect(taskStart).toContain(
      "gate_conclusion: ready_to_start_user_authorized_development",
    );
    expect(taskStart).toContain("activity_status: active_release_resilience_security_recovery_upgrade_compatibility");
    expect(taskStart).toContain("ri54_status: not_started");
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
        "CLAUDE.md": activeBlock("UI-01"),
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
          ? workBoardBody("UI-01")
          : "\n\nLegacy prose stays below.\n";
        writeEntry(root, entry, activeBlock("UI-02") + body);
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

  it("N13. current guide losing the active Semantic Judge boundary fails as AUTH-R006", () => {
    const r = runAuthority("neg-guide-loses-semantic-judge-boundary", (root) => {
      writeValidEntries(root);
      writeEntry(
        root,
        "docs/execution/CURRENT-PLAN.md",
        GUIDANCE_FIXTURES["docs/execution/CURRENT-PLAN.md"].replace(
          "completed_and_verified_implementation_real_provider_evidence_blocked",
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

  it("N15. reverting active RI-48 entry correction to planned-not-active in entry markers fails as AUTH-R002", () => {
    const r = runAuthority("neg-ri48-planned-not-active", (root) => {
      writeValidEntries(root, {
        "handoff.md": activeBlock("RI-03").replace(
          "sestina-ri48-status: completed_and_verified_implementation_real_provider_evidence_blocked",
          "sestina-ri48-status: planned_not_active",
        ),
      });
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("[AUTH-R002]");
    expect(r.stderr).toContain("sestina-ri48-status");
  });
});
