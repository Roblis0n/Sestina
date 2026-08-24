import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SequenceIdFactory } from "../../../packages/research/src/index.js";
import { prepareResearchRoomSemanticJudge } from "../../../packages/review/src/index.js";
import { validateOpenAICompatibleBaseUrl } from "../../../apps/research-room/src/provider-settings.js";

export const benchmarkRoot = resolve(import.meta.dirname, "..");
export const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
export const readJson = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));
export function readJsonLines(path) { return readFileSync(resolve(path), "utf8").split(/\r?\n/u).filter((line) => line.trim()).map((line) => JSON.parse(line)); }
export function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }

export function providerBinding(config) {
  const url = new URL(config.baseUrl);
  return Object.freeze({ id: config.providerId, family: "openai_compatible", model: config.model, baseUrlOrigin: url.origin, locality: config.locality, configGeneration: config.generation });
}

export function requestFor(testCase, index, binding) {
  const ids = new SequenceIdFactory(20_000 + index * 30);
  const projectId = ids.create("rprj_");
  const issueHistory = testCase.context.issueHistory ?? [];
  const result = prepareResearchRoomSemanticJudge({
    reviewId: ids.create("rrvw_"), projectId, provider: binding, stateBindingHash: sha256(JSON.stringify({ caseId: testCase.caseId, context: testCase.context })),
    brief: {
      id: ids.create("rbrf_"), versionNumber: 1, projectQuestion: testCase.context.projectQuestion, currentStage: "revision", currentTask: testCase.context.currentTask,
      fixedDecisions: [{ id: ids.create("rbrf_"), statement: testCase.context.fixedDecision }], expectedDeltas: [{ id: ids.create("rbrf_"), statement: testCase.context.expectedDelta }],
      evidenceBoundaries: testCase.context.evidenceBoundary === null ? [] : [testCase.context.evidenceBoundary], explicitNonGoals: ["Synthetic development evaluation only; no external-user claim."],
    },
    decisions: [{ id: ids.create("rdec_"), status: "frozen", statement: testCase.context.fixedDecision, rationale: "Synthetic locked benchmark decision.", version: 1 }],
    issues: issueHistory.map((issue) => ({ id: ids.create("riss_"), kind: "evidence_boundary", summary: issue.summary, status: issue.status, version: 1 })),
    receiptSummary: [], suggestionDocument: { projectId, artifactId: ids.create("rart_"), revisionId: ids.create("rrev_"), text: testCase.suggestion }, evidenceClass: "synthetic_fixture",
  });
  if (!result.ok) throw new Error(`case ${testCase.caseId} cannot be compiled: ${result.error.code}`);
  return result.value;
}

export function safeConfig(path) {
  const value = readJson(path);
  const keys = ["schemaVersion", "family", "providerId", "baseUrl", "model", "timeoutMs", "maxOutputTokens", "locality", "generation"];
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key)) || value.schemaVersion !== "1.0.0" || value.family !== "openai_compatible" || !["local", "external"].includes(value.locality) || !Number.isSafeInteger(value.generation) || value.generation < 1) throw new Error("safe Provider config is invalid");
  if (typeof value.providerId !== "string" || value.providerId.trim().length < 1 || value.providerId.trim().length > 128 || typeof value.model !== "string" || value.model.trim().length < 1 || value.model.trim().length > 256) throw new Error("safe Provider identity is invalid");
  if (!Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 100 || value.timeoutMs > 120_000 || (value.maxOutputTokens !== undefined && (!Number.isSafeInteger(value.maxOutputTokens) || value.maxOutputTokens < 1 || value.maxOutputTokens > 65_536))) throw new Error("safe Provider limits are invalid");
  const validated = validateOpenAICompatibleBaseUrl(value.baseUrl);
  if (validated.baseUrl !== value.baseUrl || validated.locality !== value.locality) throw new Error("safe Provider URL is invalid");
  return Object.freeze(value);
}

export function predictionFromResult(testCase, result, timing, provenance, kind = "candidate") {
  const verdicts = Object.fromEntries(result.assessments.map((item) => [item.criterionId, item.verdict]));
  return Object.freeze({
    schemaVersion: "1.0.0", kind, caseId: testCase.caseId, status: "valid", language: testCase.language, category: testCase.category,
    criterionVerdicts: verdicts, intervened: result.findings.length > 0 || result.reasonableIncrement.status === "not_supported", reasonableIncrement: result.reasonableIncrement.status,
    evidenceSpanValid: true, criterionCoverage: result.assessments.length / 9, authorityViolationAccepted: false, promptInjectionAccepted: false, requestBindingMismatchAccepted: false,
    latencyMs: timing.latencyMs, callCount: timing.callCount, costUsd: timing.costUsd ?? null, provenance,
  });
}

export function failedPrediction(testCase, status, timing, provenance, kind = "candidate") {
  return Object.freeze({ schemaVersion: "1.0.0", kind, caseId: testCase.caseId, status, language: testCase.language, category: testCase.category, criterionVerdicts: {}, intervened: false, reasonableIncrement: "unknown", evidenceSpanValid: false, criterionCoverage: 0, authorityViolationAccepted: false, promptInjectionAccepted: false, requestBindingMismatchAccepted: false, latencyMs: timing.latencyMs, callCount: timing.callCount, costUsd: timing.costUsd ?? null, provenance });
}
