import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AGENT_CORRECTOR_BUNDLE_HASH,
  AGENT_CORRECTOR_GENERATED_FILES,
  CODEX_AGENT_CORRECTOR_OPENAI_YAML,
  CODEX_AGENT_CORRECTOR_SKILL,
} from "../src/index.js";
import { checkGeneratedSkill } from "../generate.js";
import { scoreEvaluation } from "../evals/agent-corrector/score-results.mjs";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

interface EvaluationCase {
  readonly id: string;
  readonly set: "development" | "locked" | "regression";
  readonly language: "en" | "zh-CN";
  readonly criterion: string;
  readonly variant:
    "positive" | "hard-negative" | "boundary" | "missing-context";
  readonly task: string;
  readonly candidateAction: string;
  readonly expected: {
    readonly invoke: boolean;
    readonly outcome: "allow" | "steer" | "unknown";
    readonly requiresUserDecision: boolean;
  };
}

async function readJsonl(
  relativePath: string,
): Promise<readonly EvaluationCase[]> {
  const source = await readFile(join(packageRoot, relativePath), "utf8");
  return source
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EvaluationCase);
}

const expectedCriteria = [
  "focus-substitution",
  "repeated-audit",
  "audit-hijacking",
  "semantic-scope",
  "decision-integrity",
  "argument-leap",
  "evidence-boundary",
  "shallow-abstraction",
  "argument-delta",
  "completion-overclaim",
  "authorized-redirect",
  "trivial-non-trigger",
] as const;

describe("agent-corrector bundle", () => {
  it("generates one dependency-free Codex Skill bundle from canonical sources", async () => {
    await expect(checkGeneratedSkill(packageRoot)).resolves.toEqual({
      ok: true,
      drifted: [],
    });
    expect(Object.keys(AGENT_CORRECTOR_GENERATED_FILES).sort()).toEqual([
      "SKILL.md",
      "agents/openai.yaml",
      "references/drift-rubrics.md",
      "references/intervention-contract.md",
      "references/task-anchor.md",
    ]);
    expect(AGENT_CORRECTOR_BUNDLE_HASH).toMatch(/^[a-f0-9]{64}$/u);
    expect(CODEX_AGENT_CORRECTOR_SKILL).toBe(
      AGENT_CORRECTOR_GENERATED_FILES["SKILL.md"],
    );
    expect(CODEX_AGENT_CORRECTOR_OPENAI_YAML).toBe(
      AGENT_CORRECTOR_GENERATED_FILES["agents/openai.yaml"],
    );
    expect(CODEX_AGENT_CORRECTOR_OPENAI_YAML).toContain(
      "allow_implicit_invocation: true",
    );
    expect(CODEX_AGENT_CORRECTOR_OPENAI_YAML).not.toContain("dependencies:");
  });

  it("keeps discovery narrow while defining a bounded correction-and-resume loop", () => {
    expect(CODEX_AGENT_CORRECTOR_SKILL).toMatch(
      /^---\nname: agent-corrector\ndescription: /u,
    );
    expect(CODEX_AGENT_CORRECTOR_SKILL).toContain("long-running or multi-step");
    expect(CODEX_AGENT_CORRECTOR_SKILL).toContain(
      "Do not use for trivial one-step requests",
    );
    expect(CODEX_AGENT_CORRECTOR_SKILL).toContain(
      "Use first principles and proportionate control",
    );
    expect(CODEX_AGENT_CORRECTOR_SKILL).toContain("Keep hard boundaries hard");
    expect(CODEX_AGENT_CORRECTOR_SKILL).toContain("normally one and no more");
    expect(CODEX_AGENT_CORRECTOR_SKILL).toContain(
      "consequence, uncertainty, and reversibility",
    );
    expect(CODEX_AGENT_CORRECTOR_SKILL).toContain("continue the original task");
    expect(CODEX_AGENT_CORRECTOR_SKILL).toContain("references/task-anchor.md");
    expect(CODEX_AGENT_CORRECTOR_SKILL).toContain(
      "references/drift-rubrics.md",
    );
    expect(CODEX_AGENT_CORRECTOR_SKILL).toContain(
      "references/intervention-contract.md",
    );
    expect(CODEX_AGENT_CORRECTOR_SKILL).not.toMatch(
      /get_research_context|sestina review run|hidden chain-of-thought|full chain-of-thought/iu,
    );
    expect(Buffer.byteLength(CODEX_AGENT_CORRECTOR_SKILL, "utf8")).toBeLessThan(
      8_000,
    );
  });

  it("ships balanced development and locked cases instead of benchmark answers in the Skill", async () => {
    const development = await readJsonl(
      "evals/agent-corrector/development-cases.jsonl",
    );
    const locked = await readJsonl("evals/agent-corrector/locked-cases.jsonl");
    expect(development).toHaveLength(48);
    expect(locked).toHaveLength(48);
    expect(
      new Set([...development, ...locked].map((item) => item.id)).size,
    ).toBe(96);

    for (const set of [development, locked]) {
      expect(new Set(set.map((item) => item.criterion))).toEqual(
        new Set(expectedCriteria),
      );
      expect(new Set(set.map((item) => item.language))).toEqual(
        new Set(["en", "zh-CN"]),
      );
      for (const variant of [
        "positive",
        "hard-negative",
        "boundary",
        "missing-context",
      ] as const) {
        expect(set.filter((item) => item.variant === variant)).toHaveLength(12);
      }
    }

    expect(CODEX_AGENT_CORRECTOR_SKILL).not.toContain("acc-locked-");
    expect(JSON.stringify(AGENT_CORRECTOR_GENERATED_FILES)).not.toContain(
      "candidateAction",
    );
  });

  it("locks the real scope, capability, stage, and user-redirect regressions", async () => {
    const regressions = await readJsonl(
      "evals/agent-corrector/regression-cases.jsonl",
    );
    expect(regressions.map((item) => item.id).sort()).toEqual([
      "reg-authorized-user-redirect",
      "reg-coding-model-not-topic-selection",
      "reg-complete-stage-no-version-split",
      "reg-release-stop-line",
      "reg-schema-is-not-semantic-judgment",
      "reg-ui01-must-not-become-ri50",
    ]);
    expect(
      regressions.filter((item) => item.expected.outcome === "steer"),
    ).toHaveLength(5);
    expect(
      regressions.filter((item) => item.expected.outcome === "allow"),
    ).toHaveLength(1);
    expect(
      regressions.filter((item) => item.expected.requiresUserDecision),
    ).toHaveLength(0);
    expect(
      regressions.find((item) => item.id === "reg-authorized-user-redirect")
        ?.expected.invoke,
    ).toBe(false);
  });

  it("fails the behavior gate on correction-budget, resume, or private-reasoning violations", async () => {
    const regressions = await readJsonl(
      "evals/agent-corrector/regression-cases.jsonl",
    );
    const perfect = regressions.map((item) => ({
      id: item.id,
      ...item.expected,
      foregroundCorrections: item.expected.outcome === "steer" ? 1 : 0,
      resumedOriginalTask: true,
      requestsPrivateReasoning: false,
      reason: "Public, evidence-bounded reason.",
    }));
    expect(scoreEvaluation(regressions, perfect)).toMatchObject({
      passed: true,
      totalCases: 6,
      scored: 6,
      safetyViolations: [],
    });

    const advisoryInvocationMisses = perfect.map((item) => ({
      ...item,
      invoke: !item.invoke,
    }));
    expect(
      scoreEvaluation(regressions, advisoryInvocationMisses),
    ).toMatchObject({
      passed: true,
      metrics: { invocationAccuracy: 0 },
      gatePolicy: {
        advisoryMetrics: ["invocationAccuracy"],
        implicitDiscovery: "not_measured_by_explicit_invocation_harness",
      },
    });

    const unsafe = perfect.map((item, index) =>
      index === 0
        ? {
            ...item,
            foregroundCorrections: 4,
            resumedOriginalTask: false,
            requestsPrivateReasoning: true,
          }
        : item,
    );
    const result = scoreEvaluation(regressions, unsafe);
    expect(result.passed).toBe(false);
    expect(result.safetyViolations.map((item) => item.rule).sort()).toEqual([
      "foreground_correction_budget",
      "private_reasoning_request",
      "steer_without_resume",
    ]);
  });
});
