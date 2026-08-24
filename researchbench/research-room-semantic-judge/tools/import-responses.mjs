#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { submitResearchRoomSemanticJudge } from "../../../packages/review/src/index.js";
import { argument, benchmarkRoot, failedPrediction, predictionFromResult, readJson, readJsonLines } from "./benchmark-lib.mjs";

const batchPath = argument("--requests"); const responsesPath = argument("--responses");
if (!batchPath || !responsesPath) throw new Error("--requests and --responses are required");
const output = resolve(argument("--output") ?? resolve(benchmarkRoot, ".runs", "candidate-predictions.jsonl"));
const batch = readJson(batchPath);
const batchKeys = ["schemaVersion", "benchmarkClass", "split", "countsAsExternalEvidence", "provider", "caseCount", "entries"];
if (typeof batch !== "object" || batch === null || Array.isArray(batch) || Object.keys(batch).sort().join("|") !== batchKeys.sort().join("|") || batch.schemaVersion !== "1.0.0" || batch.benchmarkClass !== "development_synthetic" || !["development", "test"].includes(batch.split) || batch.countsAsExternalEvidence !== false || !Array.isArray(batch.entries) || batch.caseCount !== batch.entries.length) throw new Error("request batch is invalid");
const cases = readJsonLines(resolve(benchmarkRoot, "data", `${batch.split}.jsonl`)); const labels = new Map(cases.map((item) => [item.caseId, item]));
const responses = readJsonLines(responsesPath); const responseKeys = ["caseId", "response", "latencyMs", "callCount", "costUsd"].sort().join("|");
if (responses.length !== batch.entries.length || responses.some((item) => typeof item !== "object" || item === null || Array.isArray(item) || Object.keys(item).sort().join("|") !== responseKeys || typeof item.caseId !== "string" || typeof item.response !== "string" || !Number.isFinite(item.latencyMs) || item.latencyMs < 0 || item.callCount !== 1 || (item.costUsd !== null && (!Number.isFinite(item.costUsd) || item.costUsd < 0)))) throw new Error("response batch is invalid");
const byId = new Map(responses.map((item) => [item.caseId, item]));
if (byId.size !== responses.length || batch.entries.some((entry) => !byId.has(entry.caseId))) throw new Error("response batch must cover each request exactly once");
const predictions = [];
for (const entry of batch.entries) {
  const testCase = labels.get(entry.caseId); const supplied = byId.get(entry.caseId); if (!testCase || !supplied) throw new Error(`missing case or response: ${entry.caseId}`);
  const timing = { latencyMs: supplied.latencyMs, callCount: 1, costUsd: supplied.costUsd };
  const provenance = { providerId: entry.request.provider.id, model: entry.request.provider.model, baseUrlOrigin: entry.request.provider.baseUrlOrigin, locality: entry.request.provider.locality, configGeneration: entry.request.provider.configGeneration, protocolHash: entry.request.protocol.hash, promptHash: entry.request.prompt.hash, rubricHash: entry.request.rubric.hash, requestHash: entry.request.requestHash, executionMode: "imported_response" };
  const parsed = submitResearchRoomSemanticJudge(entry.request, supplied.response);
  predictions.push(parsed.ok ? predictionFromResult(testCase, parsed.value, timing, provenance) : failedPrediction(testCase, "invalid_response", timing, provenance));
}
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, predictions.map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8");
process.stdout.write(`${JSON.stringify({ status: "imported_and_strictly_validated", output, predictions: predictions.length, rawProviderResponsesPersisted: false })}\n`);
