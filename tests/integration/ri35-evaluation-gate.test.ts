import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  evaluateLockedRecords,
  evaluationExitCode,
  parseEvaluationResult,
  runLockedEvaluation,
  type EvaluationCase,
  type EvaluationPrediction,
  type EvaluationThresholds,
} from "../../researchbench/tools/run-evaluation.js";

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const categories = ["argument", "focus"] as const;
const testCases: readonly EvaluationCase[] = [
  {
    caseId: "case-argument-gap",
    category: "argument",
    expectedIntervention: true,
    normalControl: false,
    simulatedUserCorrection: false,
  },
  {
    caseId: "case-focus-substitution",
    category: "focus",
    expectedIntervention: true,
    normalControl: false,
    simulatedUserCorrection: true,
  },
  {
    caseId: "case-focus-gap",
    category: "focus",
    expectedIntervention: true,
    normalControl: false,
    simulatedUserCorrection: false,
  },
  {
    caseId: "case-normal-control",
    category: "argument",
    expectedIntervention: false,
    normalControl: true,
    simulatedUserCorrection: false,
  },
];

function predictions(
  overrides: Readonly<Record<string, Partial<EvaluationPrediction>>> = {},
): readonly EvaluationPrediction[] {
  return testCases.map((item) => ({
    caseId: item.caseId,
    intervened: item.expectedIntervention,
    recovered: item.simulatedUserCorrection ? true : null,
    failed: false,
    costUsd: 0.01,
    latencyMs: 10,
    ...overrides[item.caseId],
  }));
}

const thresholds: EvaluationThresholds = {
  schemaVersion: "1.0.0",
  categories: {
    argument: {
      go: { minimumPrecision: 1, minimumRecall: 1 },
      conditional: { minimumPrecision: 0.8, minimumRecall: 0.8 },
    },
    focus: {
      go: { minimumPrecision: 1, minimumRecall: 1 },
      conditional: { minimumPrecision: 0.8, minimumRecall: 0.8 },
    },
  },
  product: {
    go: {
      maximumNormalControlInterventionRate: 0,
      minimumSimulatedCorrectionRecoveryRate: 1,
      maximumFailureRate: 0,
      maximumMeanCostUsd: 0.02,
      maximumP95LatencyMs: 20,
    },
    conditional: {
      maximumNormalControlInterventionRate: 0.1,
      minimumSimulatedCorrectionRecoveryRate: 0.8,
      maximumFailureRate: 0.05,
      maximumMeanCostUsd: 0.03,
      maximumP95LatencyMs: 30,
    },
  },
};

function lockedRecords(candidate = predictions()) {
  const devCase = testCases.at(0);
  if (devCase === undefined) throw new Error("missing synthetic dev case");
  return {
    devCases: [devCase],
    testCases,
    labels: { schemaVersion: "1.0.0" as const, categories },
    thresholds,
    candidate,
    baselines: Object.fromEntries(
      ["B0", "B1", "B2", "B3", "B4"].map((id) => [id, predictions()]),
    ) as Readonly<Record<"B0" | "B1" | "B2" | "B3" | "B4", readonly EvaluationPrediction[]>>,
    trace: {
      codeCommit: "a".repeat(40),
      devSetHash: "b".repeat(64),
      testLockHash: "c".repeat(64),
      thresholdsHash: "d".repeat(64),
      labelsHash: "e".repeat(64),
      baselinesHash: "f".repeat(64),
      candidateHash: "1".repeat(64),
      promptHash: "2".repeat(64),
      resultSchemaHash: "3".repeat(64),
    },
  };
}

describe("RI-35 locked evaluation gate", () => {
  it("fails closed in the real repository when locked materials are absent", () => {
    const result = runLockedEvaluation({ repoRoot, writeReports: false });

    expect(result.status).toBe("blocked_missing_locked_benchmark");
    expect(result.decision).toBeNull();
    expect(result.missingComponents).toEqual([
      "b0_b4_baselines",
      "dev_set",
      "evaluation_labels",
      "result_schema",
      "ri_08_thresholds",
      "test_lock",
    ]);
    expect(result.lockedInputsModified).toBe(false);
    expect(result.reportPath).toBeNull();
    expect(evaluationExitCode(result)).toBe(2);
  });

  it("computes category metrics and a preregistered Go deterministically", () => {
    const first = evaluateLockedRecords(lockedRecords());
    const second = evaluateLockedRecords(lockedRecords());

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: "evaluated",
      decision: "Go",
      candidate: {
        categories: {
          argument: { precision: 1, recall: 1 },
          focus: { precision: 1, recall: 1 },
        },
        normalControlInterventionRate: 0,
        simulatedCorrectionRecoveryRate: 1,
        failureRate: 0,
        meanCostUsd: 0.01,
        p95LatencyMs: 10,
      },
    });
    expect(Object.keys(first.baselines)).toEqual([
      "B0",
      "B1",
      "B2",
      "B3",
      "B4",
    ]);
    expect(first.failureCases).toEqual([]);
    expect(evaluationExitCode(first)).toBe(0);
  });

  it("uses locked thresholds to produce No-Go Semantic without changing labels", () => {
    const result = evaluateLockedRecords(lockedRecords(predictions({
      "case-focus-gap": { intervened: false },
    })));

    expect(result.status).toBe("evaluated");
    expect(result.decision).toBe("No-Go Semantic");
    expect(result.failureCases).toEqual([
      {
        caseId: "case-focus-gap",
        category: "focus",
        reasons: ["false_negative"],
      },
    ]);
    expect(testCases[2]?.expectedIntervention).toBe(true);
  });

  it("rejects malformed machine-readable results", () => {
    expect(parseEvaluationResult({})).toMatchObject({
      ok: false,
      error: "invalid_evaluation_result",
    });
  });
});
