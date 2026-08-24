#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { submitResearchRoomSemanticJudge } from "../../../packages/review/src/index.js";
import { createOpenAICompatibleProvider } from "../../../apps/research-room/src/openai-compatible-provider.js";
import { argument, benchmarkRoot, failedPrediction, predictionFromResult, providerBinding, readJsonLines, requestFor, safeConfig } from "./benchmark-lib.mjs";

if (!process.argv.includes("--confirm-synthetic-send")) throw new Error("--confirm-synthetic-send is required; no Provider call was made");
const configPath = argument("--provider-config"); const split = argument("--split") ?? "development"; const maximum = Number(argument("--max-cases"));
if (!configPath || !["development", "test"].includes(split) || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > 200) throw new Error("--provider-config, a valid --split, and --max-cases 1..200 are required");
const config = safeConfig(configPath); const apiKey = process.env.SESTINA_JUDGE_API_KEY;
if (config.locality === "external" && !apiKey) throw new Error("SESTINA_JUDGE_API_KEY must be explicitly supplied for external HTTPS; no Provider call was made");
const output = resolve(argument("--output") ?? resolve(benchmarkRoot, ".runs", `${split}-candidate-predictions.jsonl`));
const provider = createOpenAICompatibleProvider({ config, ...(apiKey ? { apiKey } : {}) }, { readCurrentGeneration: () => Promise.resolve(config.generation) });
const cases = readJsonLines(resolve(benchmarkRoot, "data", `${split}.jsonl`)).slice(0, maximum); const predictions = [];
for (let index = 0; index < cases.length; index += 1) {
  const testCase = cases[index]; const request = requestFor(testCase, index, providerBinding(config)); const preview = provider.prepare(request); const started = performance.now();
  const provenance = { providerId: config.providerId, model: config.model, baseUrlOrigin: new URL(config.baseUrl).origin, locality: config.locality, configGeneration: config.generation, protocolHash: request.protocol.hash, promptHash: request.prompt.hash, rubricHash: request.rubric.hash, requestHash: request.requestHash, executionMode: "live_provider" };
  try {
    const response = await provider.analyze(request, preview, { signal: new AbortController().signal }); const parsed = submitResearchRoomSemanticJudge(request, response); const timing = { latencyMs: Math.round(performance.now() - started), callCount: 1, costUsd: null };
    predictions.push(parsed.ok ? predictionFromResult(testCase, parsed.value, timing, provenance) : failedPrediction(testCase, "invalid_response", timing, provenance));
  } catch { predictions.push(failedPrediction(testCase, "provider_failed", { latencyMs: Math.round(performance.now() - started), callCount: 1, costUsd: null }, provenance)); }
}
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, predictions.map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8");
process.stdout.write(`${JSON.stringify({ status: "completed_synthetic_provider_run", output, calls: predictions.reduce((sum, item) => sum + item.callCount, 0), rawProviderResponsesPersisted: false, apiKeyPersisted: false })}\n`);
