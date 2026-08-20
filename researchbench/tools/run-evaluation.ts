import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const EVALUATION_RESULT_SCHEMA_VERSION = "1.0.0" as const;
export const LOCKED_EVALUATION_MANIFEST_PATH =
  "researchbench/locked/ri-35-evaluation-lock.json";
export const EVALUATION_REPORT_PATH =
  "researchbench/reports/MVP-B-EVALUATION.md";
export const EVALUATION_JSON_REPORT_PATH =
  "researchbench/reports/MVP-B-EVALUATION.json";

export type EvaluationDecision =
  | "Go"
  | "Conditional Go"
  | "No-Go Semantic"
  | "No-Go Product";

export type LockedBenchmarkComponent =
  | "b0_b4_baselines"
  | "dev_set"
  | "evaluation_labels"
  | "result_schema"
  | "ri_08_thresholds"
  | "test_lock";

export interface EvaluationCase {
  readonly caseId: string;
  readonly category: string;
  readonly expectedIntervention: boolean;
  readonly normalControl: boolean;
  readonly simulatedUserCorrection: boolean;
}

export interface EvaluationPrediction {
  readonly caseId: string;
  readonly intervened: boolean;
  readonly recovered: boolean | null;
  readonly failed: boolean;
  readonly costUsd: number;
  readonly latencyMs: number;
}

export interface SemanticThreshold {
  readonly minimumPrecision: number;
  readonly minimumRecall: number;
}

export interface ProductThreshold {
  readonly maximumNormalControlInterventionRate: number;
  readonly minimumSimulatedCorrectionRecoveryRate: number;
  readonly maximumFailureRate: number;
  readonly maximumMeanCostUsd: number;
  readonly maximumP95LatencyMs: number;
}

export interface EvaluationThresholds {
  readonly schemaVersion: "1.0.0";
  readonly categories: Readonly<Record<string, {
    readonly go: SemanticThreshold;
    readonly conditional: SemanticThreshold;
  }>>;
  readonly product: {
    readonly go: ProductThreshold;
    readonly conditional: ProductThreshold;
  };
}

export interface EvaluationTrace {
  readonly codeCommit: string | null;
  readonly devSetHash: string | null;
  readonly testLockHash: string | null;
  readonly thresholdsHash: string | null;
  readonly labelsHash: string | null;
  readonly baselinesHash: string | null;
  readonly candidateHash: string | null;
  readonly promptHash: string | null;
  readonly resultSchemaHash: string | null;
}

export interface CategoryEvaluationMetrics {
  readonly truePositive: number;
  readonly falsePositive: number;
  readonly falseNegative: number;
  readonly precision: number;
  readonly recall: number;
}

export interface EvaluationMetrics {
  readonly categories: Readonly<Record<string, CategoryEvaluationMetrics>>;
  readonly normalControlInterventionRate: number;
  readonly simulatedCorrectionRecoveryRate: number;
  readonly failureRate: number;
  readonly meanCostUsd: number;
  readonly p95LatencyMs: number;
}

export interface EvaluationFailureCase {
  readonly caseId: string;
  readonly category: string;
  readonly reasons: readonly (
    | "execution_failed"
    | "false_negative"
    | "false_positive"
    | "simulated_correction_not_recovered"
  )[];
}

export interface BlockedEvaluationResult {
  readonly schemaVersion: typeof EVALUATION_RESULT_SCHEMA_VERSION;
  readonly status:
    | "blocked_missing_locked_benchmark"
    | "blocked_invalid_locked_benchmark";
  readonly decision: null;
  readonly missingComponents: readonly LockedBenchmarkComponent[];
  readonly diagnostic: string;
  readonly trace: EvaluationTrace;
  readonly candidate: null;
  readonly baselines: Readonly<Record<string, never>>;
  readonly failureCases: readonly [];
  readonly lockedInputsModified: false;
  readonly reportPath: null;
}

export interface EvaluatedResult {
  readonly schemaVersion: typeof EVALUATION_RESULT_SCHEMA_VERSION;
  readonly status: "evaluated";
  readonly decision: EvaluationDecision;
  readonly missingComponents: readonly [];
  readonly diagnostic: "locked_evaluation_completed";
  readonly trace: EvaluationTrace;
  readonly candidate: EvaluationMetrics;
  readonly baselines: Readonly<Record<
    "B0" | "B1" | "B2" | "B3" | "B4",
    EvaluationMetrics
  >>;
  readonly failureCases: readonly EvaluationFailureCase[];
  readonly lockedInputsModified: false;
  readonly reportPath: string | null;
}

export type EvaluationResult = BlockedEvaluationResult | EvaluatedResult;

export interface LockedEvaluationRecords {
  readonly devCases: readonly EvaluationCase[];
  readonly testCases: readonly EvaluationCase[];
  readonly labels: {
    readonly schemaVersion: "1.0.0";
    readonly categories: readonly string[];
  };
  readonly thresholds: EvaluationThresholds;
  readonly candidate: readonly EvaluationPrediction[];
  readonly baselines: Readonly<Record<
    "B0" | "B1" | "B2" | "B3" | "B4",
    readonly EvaluationPrediction[]
  >>;
  readonly trace: EvaluationTrace;
}

interface FileReference {
  readonly path: string;
  readonly sha256: string;
}

interface EvaluationManifest {
  readonly schemaVersion: "1.0.0";
  readonly devSet: FileReference;
  readonly testLock: FileReference;
  readonly thresholds: FileReference;
  readonly labels: FileReference;
  readonly resultSchema: FileReference;
  readonly baselines: readonly [
    { readonly id: "B0"; readonly predictions: FileReference },
    { readonly id: "B1"; readonly predictions: FileReference },
    { readonly id: "B2"; readonly predictions: FileReference },
    { readonly id: "B3"; readonly predictions: FileReference },
    { readonly id: "B4"; readonly predictions: FileReference },
  ];
  readonly candidate: {
    readonly predictionsPath: string;
    readonly promptHash: string;
  };
}

interface RunEvaluationOptions {
  readonly repoRoot: string;
  readonly writeReports?: boolean;
  readonly manifestPath?: string;
  readonly trackedFile?: (relativePath: string) => boolean;
  readonly codeCommit?: string | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function rate(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && value <= 1;
}

function nonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function emptyTrace(codeCommit: string | null): EvaluationTrace {
  return Object.freeze({
    codeCommit,
    devSetHash: null,
    testLockHash: null,
    thresholdsHash: null,
    labelsHash: null,
    baselinesHash: null,
    candidateHash: null,
    promptHash: null,
    resultSchemaHash: null,
  });
}

const ALL_COMPONENTS: readonly LockedBenchmarkComponent[] = Object.freeze([
  "b0_b4_baselines",
  "dev_set",
  "evaluation_labels",
  "result_schema",
  "ri_08_thresholds",
  "test_lock",
]);

function blocked(
  status: BlockedEvaluationResult["status"],
  diagnostic: string,
  trace: EvaluationTrace,
  missingComponents: readonly LockedBenchmarkComponent[] = ALL_COMPONENTS,
): BlockedEvaluationResult {
  return Object.freeze({
    schemaVersion: EVALUATION_RESULT_SCHEMA_VERSION,
    status,
    decision: null,
    missingComponents: Object.freeze([...missingComponents].sort()),
    diagnostic,
    trace: Object.freeze({ ...trace }),
    candidate: null,
    baselines: Object.freeze({}),
    failureCases: Object.freeze([]),
    lockedInputsModified: false,
    reportPath: null,
  });
}

function parseFileReference(value: unknown): FileReference | undefined {
  if (!record(value) || !nonBlank(value.path) || !hash(value.sha256)) {
    return undefined;
  }
  return Object.freeze({ path: value.path, sha256: value.sha256 });
}

function parseManifest(value: unknown): EvaluationManifest | undefined {
  if (
    !record(value)
    || value.schemaVersion !== "1.0.0"
    || !Array.isArray(value.baselines)
    || value.baselines.length !== 5
    || !record(value.candidate)
    || !nonBlank(value.candidate.predictionsPath)
    || !hash(value.candidate.promptHash)
  ) return undefined;
  const devSet = parseFileReference(value.devSet);
  const testLock = parseFileReference(value.testLock);
  const thresholds = parseFileReference(value.thresholds);
  const labels = parseFileReference(value.labels);
  const resultSchema = parseFileReference(value.resultSchema);
  if (
    devSet === undefined
    || testLock === undefined
    || thresholds === undefined
    || labels === undefined
    || resultSchema === undefined
  ) return undefined;
  const baselineIds = ["B0", "B1", "B2", "B3", "B4"] as const;
  const baselines: {
    id: typeof baselineIds[number];
    predictions: FileReference;
  }[] = [];
  const rawBaselines = value.baselines as unknown[];
  for (let index = 0; index < baselineIds.length; index += 1) {
    const raw: unknown = rawBaselines[index];
    const id = baselineIds[index];
    if (!record(raw) || raw.id !== id) return undefined;
    const predictions = parseFileReference(raw.predictions);
    if (predictions === undefined) return undefined;
    baselines.push({ id, predictions });
  }
  return Object.freeze({
    schemaVersion: "1.0.0",
    devSet,
    testLock,
    thresholds,
    labels,
    resultSchema,
    baselines: baselines as unknown as EvaluationManifest["baselines"],
    candidate: Object.freeze({
      predictionsPath: value.candidate.predictionsPath,
      promptHash: value.candidate.promptHash,
    }),
  });
}

function parseCase(value: unknown): EvaluationCase | undefined {
  if (
    !record(value)
    || !nonBlank(value.caseId)
    || !nonBlank(value.category)
    || typeof value.expectedIntervention !== "boolean"
    || typeof value.normalControl !== "boolean"
    || typeof value.simulatedUserCorrection !== "boolean"
    || (value.normalControl && value.expectedIntervention)
  ) return undefined;
  return Object.freeze({
    caseId: value.caseId,
    category: value.category,
    expectedIntervention: value.expectedIntervention,
    normalControl: value.normalControl,
    simulatedUserCorrection: value.simulatedUserCorrection,
  });
}

function parsePrediction(value: unknown): EvaluationPrediction | undefined {
  if (
    !record(value)
    || !nonBlank(value.caseId)
    || typeof value.intervened !== "boolean"
    || ![true, false, null].includes(value.recovered as boolean | null)
    || typeof value.failed !== "boolean"
    || !nonNegative(value.costUsd)
    || !Number.isSafeInteger(value.latencyMs)
    || Number(value.latencyMs) < 0
  ) return undefined;
  return Object.freeze({
    caseId: value.caseId,
    intervened: value.intervened,
    recovered: value.recovered as boolean | null,
    failed: value.failed,
    costUsd: value.costUsd,
    latencyMs: Number(value.latencyMs),
  });
}

function parseJsonLines<T>(
  raw: string,
  parser: (value: unknown) => T | undefined,
): readonly T[] | undefined {
  const result: T[] = [];
  const lines = raw.split(/\r?\n/gu).filter((line) => line.trim().length > 0);
  for (const line of lines) {
    try {
      const parsed = parser(JSON.parse(line) as unknown);
      if (parsed === undefined) return undefined;
      result.push(parsed);
    } catch {
      return undefined;
    }
  }
  return result.length > 0 ? Object.freeze(result) : undefined;
}

function semanticThreshold(value: unknown): SemanticThreshold | undefined {
  if (
    !record(value)
    || !rate(value.minimumPrecision)
    || !rate(value.minimumRecall)
  ) return undefined;
  return Object.freeze({
    minimumPrecision: value.minimumPrecision,
    minimumRecall: value.minimumRecall,
  });
}

function productThreshold(value: unknown): ProductThreshold | undefined {
  if (
    !record(value)
    || !rate(value.maximumNormalControlInterventionRate)
    || !rate(value.minimumSimulatedCorrectionRecoveryRate)
    || !rate(value.maximumFailureRate)
    || !nonNegative(value.maximumMeanCostUsd)
    || !Number.isSafeInteger(value.maximumP95LatencyMs)
    || Number(value.maximumP95LatencyMs) < 0
  ) return undefined;
  return Object.freeze({
    maximumNormalControlInterventionRate:
      value.maximumNormalControlInterventionRate,
    minimumSimulatedCorrectionRecoveryRate:
      value.minimumSimulatedCorrectionRecoveryRate,
    maximumFailureRate: value.maximumFailureRate,
    maximumMeanCostUsd: value.maximumMeanCostUsd,
    maximumP95LatencyMs: Number(value.maximumP95LatencyMs),
  });
}

function parseThresholds(value: unknown): EvaluationThresholds | undefined {
  if (
    !record(value)
    || value.schemaVersion !== "1.0.0"
    || !record(value.categories)
    || Object.keys(value.categories).length === 0
    || !record(value.product)
  ) return undefined;
  const categories: Record<string, {
    go: SemanticThreshold;
    conditional: SemanticThreshold;
  }> = {};
  for (const [category, raw] of Object.entries(value.categories).sort()) {
    if (!nonBlank(category) || !record(raw)) return undefined;
    const go = semanticThreshold(raw.go);
    const conditional = semanticThreshold(raw.conditional);
    if (
      go === undefined
      || conditional === undefined
      || conditional.minimumPrecision > go.minimumPrecision
      || conditional.minimumRecall > go.minimumRecall
    ) return undefined;
    categories[category] = Object.freeze({ go, conditional });
  }
  const go = productThreshold(value.product.go);
  const conditional = productThreshold(value.product.conditional);
  if (
    go === undefined
    || conditional === undefined
    || conditional.maximumNormalControlInterventionRate
      < go.maximumNormalControlInterventionRate
    || conditional.minimumSimulatedCorrectionRecoveryRate
      > go.minimumSimulatedCorrectionRecoveryRate
    || conditional.maximumFailureRate < go.maximumFailureRate
    || conditional.maximumMeanCostUsd < go.maximumMeanCostUsd
    || conditional.maximumP95LatencyMs < go.maximumP95LatencyMs
  ) return undefined;
  return Object.freeze({
    schemaVersion: "1.0.0",
    categories: Object.freeze(categories),
    product: Object.freeze({ go, conditional }),
  });
}

function parseLabels(value: unknown): LockedEvaluationRecords["labels"] | undefined {
  if (
    !record(value)
    || value.schemaVersion !== "1.0.0"
    || !Array.isArray(value.categories)
    || value.categories.length === 0
  ) return undefined;
  const categories: string[] = [];
  for (const item of value.categories as unknown[]) {
    if (!nonBlank(item) || categories.includes(item)) return undefined;
    categories.push(item);
  }
  return Object.freeze({
    schemaVersion: "1.0.0",
    categories: Object.freeze(categories.sort()),
  });
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function metricsFor(
  cases: readonly EvaluationCase[],
  predictions: readonly EvaluationPrediction[],
  categories: readonly string[],
): EvaluationMetrics | undefined {
  if (predictions.length !== cases.length) return undefined;
  const byId = new Map<string, EvaluationPrediction>();
  for (const prediction of predictions) {
    if (byId.has(prediction.caseId)) return undefined;
    byId.set(prediction.caseId, prediction);
  }
  if (
    cases.some((item) => {
      const prediction = byId.get(item.caseId);
      return prediction === undefined
        || (item.simulatedUserCorrection
          ? prediction.recovered === null
          : prediction.recovered !== null);
    })
  ) return undefined;
  const categoryMetrics: Record<string, CategoryEvaluationMetrics> = {};
  for (const category of categories) {
    const selected = cases.filter((item) => item.category === category);
    if (selected.length === 0) return undefined;
    let truePositive = 0;
    let falsePositive = 0;
    let falseNegative = 0;
    for (const item of selected) {
      const prediction = byId.get(item.caseId);
      if (prediction === undefined) return undefined;
      if (prediction.intervened && item.expectedIntervention) truePositive += 1;
      if (prediction.intervened && !item.expectedIntervention) falsePositive += 1;
      if (!prediction.intervened && item.expectedIntervention) falseNegative += 1;
    }
    const predictedPositive = truePositive + falsePositive;
    const expectedPositive = truePositive + falseNegative;
    categoryMetrics[category] = Object.freeze({
      truePositive,
      falsePositive,
      falseNegative,
      precision: predictedPositive === 0 ? 1 : rounded(truePositive / predictedPositive),
      recall: expectedPositive === 0 ? 1 : rounded(truePositive / expectedPositive),
    });
  }
  const normal = cases.filter((item) => item.normalControl);
  const simulated = cases.filter((item) => item.simulatedUserCorrection);
  if (normal.length === 0 || simulated.length === 0) return undefined;
  const normalInterventions = normal.filter(
    (item) => byId.get(item.caseId)?.intervened === true,
  ).length;
  const recovered = simulated.filter(
    (item) => byId.get(item.caseId)?.recovered === true,
  ).length;
  const failed = predictions.filter((item) => item.failed).length;
  const totalCost = predictions.reduce((total, item) => total + item.costUsd, 0);
  const latencies = predictions.map((item) => item.latencyMs).sort((a, b) => a - b);
  const p95Index = Math.max(0, Math.ceil(latencies.length * 0.95) - 1);
  return Object.freeze({
    categories: Object.freeze(categoryMetrics),
    normalControlInterventionRate: rounded(normalInterventions / normal.length),
    simulatedCorrectionRecoveryRate: rounded(recovered / simulated.length),
    failureRate: rounded(failed / predictions.length),
    meanCostUsd: rounded(totalCost / predictions.length),
    p95LatencyMs: latencies[p95Index] ?? 0,
  });
}

function semanticPass(
  metrics: EvaluationMetrics,
  thresholds: EvaluationThresholds,
  level: "go" | "conditional",
): boolean {
  return Object.entries(thresholds.categories).every(([category, gate]) => {
    const actual = metrics.categories[category];
    const expected = gate[level];
    return actual !== undefined
      && actual.precision >= expected.minimumPrecision
      && actual.recall >= expected.minimumRecall;
  });
}

function productPass(
  metrics: EvaluationMetrics,
  threshold: ProductThreshold,
): boolean {
  return metrics.normalControlInterventionRate
      <= threshold.maximumNormalControlInterventionRate
    && metrics.simulatedCorrectionRecoveryRate
      >= threshold.minimumSimulatedCorrectionRecoveryRate
    && metrics.failureRate <= threshold.maximumFailureRate
    && metrics.meanCostUsd <= threshold.maximumMeanCostUsd
    && metrics.p95LatencyMs <= threshold.maximumP95LatencyMs;
}

function decisionFor(
  metrics: EvaluationMetrics,
  thresholds: EvaluationThresholds,
): EvaluationDecision {
  const semanticGo = semanticPass(metrics, thresholds, "go");
  const productGo = productPass(metrics, thresholds.product.go);
  if (semanticGo && productGo) return "Go";
  const semanticConditional = semanticPass(metrics, thresholds, "conditional");
  const productConditional = productPass(metrics, thresholds.product.conditional);
  if (semanticConditional && productConditional) return "Conditional Go";
  return semanticConditional ? "No-Go Product" : "No-Go Semantic";
}

function failuresFor(
  cases: readonly EvaluationCase[],
  predictions: readonly EvaluationPrediction[],
): readonly EvaluationFailureCase[] {
  const byId = new Map(predictions.map((item) => [item.caseId, item] as const));
  const result: EvaluationFailureCase[] = [];
  for (const item of [...cases].sort((left, right) => left.caseId.localeCompare(right.caseId))) {
    const prediction = byId.get(item.caseId);
    if (prediction === undefined) continue;
    const reasons: EvaluationFailureCase["reasons"][number][] = [];
    if (prediction.failed) reasons.push("execution_failed");
    if (prediction.intervened && !item.expectedIntervention) reasons.push("false_positive");
    if (!prediction.intervened && item.expectedIntervention) reasons.push("false_negative");
    if (item.simulatedUserCorrection && prediction.recovered !== true) {
      reasons.push("simulated_correction_not_recovered");
    }
    if (reasons.length > 0) {
      result.push(Object.freeze({
        caseId: item.caseId,
        category: item.category,
        reasons: Object.freeze(reasons),
      }));
    }
  }
  return Object.freeze(result);
}

export function evaluateLockedRecords(
  records: LockedEvaluationRecords,
): EvaluationResult {
  const labels = parseLabels(records.labels);
  const thresholds = parseThresholds(records.thresholds);
  const devCases = Array.isArray(records.devCases)
    ? records.devCases.map(parseCase)
    : [];
  const testCases = Array.isArray(records.testCases)
    ? records.testCases.map(parseCase)
    : [];
  if (
    labels === undefined
    || thresholds === undefined
    || devCases.length === 0
    || devCases.some((item) => item === undefined)
    || testCases.length === 0
    || testCases.some((item) => item === undefined)
    || labels.categories.some(
      (category) => thresholds.categories[category] === undefined,
    )
    || Object.keys(thresholds.categories).some(
      (category) => !labels.categories.includes(category),
    )
    || [...devCases, ...testCases].some(
      (item) => item !== undefined && !labels.categories.includes(item.category),
    )
    || new Set(devCases.map((item) => item?.caseId)).size !== devCases.length
    || new Set(testCases.map((item) => item?.caseId)).size !== testCases.length
  ) {
    return blocked(
      "blocked_invalid_locked_benchmark",
      "locked benchmark records do not match the evaluation schema",
      records.trace,
      [],
    );
  }
  const validCases = testCases as EvaluationCase[];
  const candidate = metricsFor(validCases, records.candidate, labels.categories);
  const baselines: Partial<EvaluatedResult["baselines"]> = {};
  for (const id of ["B0", "B1", "B2", "B3", "B4"] as const) {
    const metrics = metricsFor(validCases, records.baselines[id], labels.categories);
    if (metrics === undefined) {
      return blocked(
        "blocked_invalid_locked_benchmark",
        `baseline ${id} does not cover the locked test cases`,
        records.trace,
        ["b0_b4_baselines"],
      );
    }
    baselines[id] = metrics;
  }
  if (candidate === undefined) {
    return blocked(
      "blocked_invalid_locked_benchmark",
      "candidate results do not cover the locked test cases",
      records.trace,
      [],
    );
  }
  return Object.freeze({
    schemaVersion: EVALUATION_RESULT_SCHEMA_VERSION,
    status: "evaluated",
    decision: decisionFor(candidate, thresholds),
    missingComponents: Object.freeze([]),
    diagnostic: "locked_evaluation_completed",
    trace: Object.freeze({ ...records.trace }),
    candidate,
    baselines: Object.freeze(baselines) as EvaluatedResult["baselines"],
    failureCases: failuresFor(validCases, records.candidate),
    lockedInputsModified: false,
    reportPath: null,
  });
}

function safeRepoPath(repoRoot: string, path: string): string | undefined {
  if (isAbsolute(path)) return undefined;
  const absolute = resolve(repoRoot, path);
  const child = relative(repoRoot, absolute);
  if (child === "" || child.startsWith("..") || isAbsolute(child)) return undefined;
  return absolute;
}

function gitTracked(repoRoot: string, path: string): boolean {
  const result = spawnSync(
    "git",
    ["ls-files", "--error-unmatch", "--", path],
    { cwd: repoRoot, encoding: "utf8", windowsHide: true },
  );
  return result.status === 0;
}

function gitCommit(repoRoot: string): string | null {
  const result = spawnSync(
    "git",
    ["rev-parse", "HEAD"],
    { cwd: repoRoot, encoding: "utf8", windowsHide: true },
  );
  const value = result.status === 0 ? result.stdout.trim() : "";
  return /^[a-f0-9]{40}$/u.test(value) ? value : null;
}

function readLocked(
  repoRoot: string,
  reference: FileReference,
  tracked: (path: string) => boolean,
): { readonly raw: string; readonly hash: string } | undefined {
  const absolute = safeRepoPath(repoRoot, reference.path);
  if (absolute === undefined || !tracked(reference.path) || !existsSync(absolute)) {
    return undefined;
  }
  const raw = readFileSync(absolute, "utf8");
  const actual = sha256(raw);
  return actual === reference.sha256
    ? Object.freeze({ raw, hash: actual })
    : undefined;
}

function json(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function renderEvaluationMarkdown(result: EvaluatedResult): string {
  const lines = [
    "# MVP-B Locked Evaluation",
    "",
    `- Decision: ${result.decision}`,
    `- Code commit: ${result.trace.codeCommit ?? "unavailable"}`,
    `- Test lock hash: ${result.trace.testLockHash ?? "unavailable"}`,
    `- Prompt hash: ${result.trace.promptHash ?? "unavailable"}`,
    "",
    "## Candidate metrics",
    ...Object.entries(result.candidate.categories).sort(([left], [right]) => left.localeCompare(right)).map(
      ([category, value]) => `- ${category}: precision ${value.precision}, recall ${value.recall}`,
    ),
    `- Normal-control intervention rate: ${result.candidate.normalControlInterventionRate}`,
    `- Simulated-correction recovery rate: ${result.candidate.simulatedCorrectionRecoveryRate}`,
    `- Failure rate: ${result.candidate.failureRate}`,
    `- Mean cost USD: ${result.candidate.meanCostUsd}`,
    `- p95 latency ms: ${result.candidate.p95LatencyMs}`,
    "",
    "## B0-B4 comparison",
    ...Object.entries(result.baselines).map(([id, value]) =>
      `- ${id}: normal-control ${value.normalControlInterventionRate}, recovery ${value.simulatedCorrectionRecoveryRate}, failure ${value.failureRate}, mean cost ${value.meanCostUsd}, p95 latency ${value.p95LatencyMs}`),
    "",
    "## Failure cases",
    ...(result.failureCases.length === 0
      ? ["- None"]
      : result.failureCases.map((item) =>
        `- ${item.caseId} (${item.category}): ${item.reasons.join(", ")}`)),
    "",
  ];
  return lines.join("\n");
}

function withReportPath(result: EvaluatedResult, reportPath: string): EvaluatedResult {
  return Object.freeze({ ...result, reportPath });
}

export function runLockedEvaluation(
  options: RunEvaluationOptions,
): EvaluationResult {
  const repoRoot = resolve(options.repoRoot);
  const codeCommit = options.codeCommit === undefined
    ? gitCommit(repoRoot)
    : options.codeCommit;
  const manifestPath = options.manifestPath ?? LOCKED_EVALUATION_MANIFEST_PATH;
  const manifestAbsolute = safeRepoPath(repoRoot, manifestPath);
  const tracked = options.trackedFile ?? ((path: string) => gitTracked(repoRoot, path));
  if (
    manifestAbsolute === undefined
    || !existsSync(manifestAbsolute)
    || !tracked(manifestPath)
  ) {
    return blocked(
      "blocked_missing_locked_benchmark",
      `missing tracked lock manifest: ${LOCKED_EVALUATION_MANIFEST_PATH}`,
      emptyTrace(codeCommit),
    );
  }
  const manifestRaw = readFileSync(manifestAbsolute, "utf8");
  const manifest = parseManifest(json(manifestRaw));
  if (manifest === undefined) {
    return blocked(
      "blocked_invalid_locked_benchmark",
      "lock manifest does not match the RI-35 evaluation manifest schema",
      emptyTrace(codeCommit),
      [],
    );
  }

  const references: [
    LockedBenchmarkComponent,
    FileReference,
  ][] = [
    ["dev_set", manifest.devSet],
    ["test_lock", manifest.testLock],
    ["ri_08_thresholds", manifest.thresholds],
    ["evaluation_labels", manifest.labels],
    ["result_schema", manifest.resultSchema],
    ...manifest.baselines.map(
      (item) => ["b0_b4_baselines", item.predictions] as const,
    ),
  ];
  const loaded = new Map<FileReference, { raw: string; hash: string }>();
  const missing = new Set<LockedBenchmarkComponent>();
  for (const [component, reference] of references) {
    const value = readLocked(repoRoot, reference, tracked);
    if (value === undefined) missing.add(component);
    else loaded.set(reference, value);
  }
  if (missing.size > 0) {
    return blocked(
      "blocked_missing_locked_benchmark",
      "one or more locked inputs are missing, untracked, or do not match their registered hash",
      emptyTrace(codeCommit),
      [...missing],
    );
  }

  const candidateAbsolute = safeRepoPath(
    repoRoot,
    manifest.candidate.predictionsPath,
  );
  if (candidateAbsolute === undefined || !existsSync(candidateAbsolute)) {
    return blocked(
      "blocked_invalid_locked_benchmark",
      "candidate prediction results are unavailable",
      emptyTrace(codeCommit),
      [],
    );
  }
  const candidateRaw = readFileSync(candidateAbsolute, "utf8");
  const dev = loaded.get(manifest.devSet);
  const test = loaded.get(manifest.testLock);
  const threshold = loaded.get(manifest.thresholds);
  const label = loaded.get(manifest.labels);
  const resultSchema = loaded.get(manifest.resultSchema);
  if (
    dev === undefined
    || test === undefined
    || threshold === undefined
    || label === undefined
    || resultSchema === undefined
  ) {
    return blocked(
      "blocked_invalid_locked_benchmark",
      "locked input lookup invariant failed",
      emptyTrace(codeCommit),
      [],
    );
  }
  const devCases = parseJsonLines(dev.raw, parseCase);
  const testCases = parseJsonLines(test.raw, parseCase);
  const labels = parseLabels(json(label.raw));
  const thresholds = parseThresholds(json(threshold.raw));
  const candidate = parseJsonLines(candidateRaw, parsePrediction);
  const baselineRecords: Partial<LockedEvaluationRecords["baselines"]> = {};
  for (const item of manifest.baselines) {
    const raw = loaded.get(item.predictions);
    const predictions = raw === undefined
      ? undefined
      : parseJsonLines(raw.raw, parsePrediction);
    if (predictions === undefined) {
      return blocked(
        "blocked_invalid_locked_benchmark",
        `baseline ${item.id} predictions are invalid`,
        emptyTrace(codeCommit),
        ["b0_b4_baselines"],
      );
    }
    baselineRecords[item.id] = predictions;
  }
  if (
    devCases === undefined
    || testCases === undefined
    || labels === undefined
    || thresholds === undefined
    || candidate === undefined
    || !record(json(resultSchema.raw))
  ) {
    return blocked(
      "blocked_invalid_locked_benchmark",
      "locked evaluation data or candidate results are invalid",
      emptyTrace(codeCommit),
      [],
    );
  }
  const baselinesHash = sha256(JSON.stringify(
    manifest.baselines.map((item) => [item.id, item.predictions.sha256]),
  ));
  const trace: EvaluationTrace = Object.freeze({
    codeCommit,
    devSetHash: dev.hash,
    testLockHash: test.hash,
    thresholdsHash: threshold.hash,
    labelsHash: label.hash,
    baselinesHash,
    candidateHash: sha256(candidateRaw),
    promptHash: manifest.candidate.promptHash,
    resultSchemaHash: resultSchema.hash,
  });
  const result = evaluateLockedRecords({
    devCases,
    testCases,
    labels,
    thresholds,
    candidate,
    baselines: baselineRecords as LockedEvaluationRecords["baselines"],
    trace,
  });
  if (result.status !== "evaluated" || options.writeReports === false) {
    return result;
  }
  const markdownPath = safeRepoPath(repoRoot, EVALUATION_REPORT_PATH);
  const jsonPath = safeRepoPath(repoRoot, EVALUATION_JSON_REPORT_PATH);
  if (markdownPath === undefined || jsonPath === undefined) {
    return blocked(
      "blocked_invalid_locked_benchmark",
      "evaluation report path is invalid",
      trace,
      [],
    );
  }
  mkdirSync(dirname(markdownPath), { recursive: true });
  const reported = withReportPath(result, EVALUATION_REPORT_PATH);
  writeFileSync(markdownPath, renderEvaluationMarkdown(reported), "utf8");
  writeFileSync(jsonPath, `${JSON.stringify(reported, null, 2)}\n`, "utf8");
  return reported;
}

export function parseEvaluationResult(
  input: unknown,
): { readonly ok: true; readonly value: EvaluationResult }
  | { readonly ok: false; readonly error: "invalid_evaluation_result" } {
  if (
    !record(input)
    || input.schemaVersion !== EVALUATION_RESULT_SCHEMA_VERSION
    || ![
      "blocked_missing_locked_benchmark",
      "blocked_invalid_locked_benchmark",
      "evaluated",
    ].includes(String(input.status))
    || !record(input.trace)
    || input.lockedInputsModified !== false
    || !Array.isArray(input.missingComponents)
    || !Array.isArray(input.failureCases)
  ) return { ok: false, error: "invalid_evaluation_result" };
  if (input.status === "evaluated") {
    if (
      !["Go", "Conditional Go", "No-Go Semantic", "No-Go Product"].includes(
        String(input.decision),
      )
      || !record(input.candidate)
      || !record(input.baselines)
      || input.missingComponents.length > 0
    ) return { ok: false, error: "invalid_evaluation_result" };
  } else if (input.decision !== null || input.candidate !== null) {
    return { ok: false, error: "invalid_evaluation_result" };
  }
  return {
    ok: true,
    value: structuredClone(input) as EvaluationResult,
  };
}

export function evaluationExitCode(result: EvaluationResult): 0 | 2 {
  return result.status === "evaluated" ? 0 : 2;
}

function isMainModule(): boolean {
  if (process.argv[1] === undefined) return false;
  return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const result = runLockedEvaluation({
    repoRoot: process.cwd(),
    writeReports: true,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = evaluationExitCode(result);
}
