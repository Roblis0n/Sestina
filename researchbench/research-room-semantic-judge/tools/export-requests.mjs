#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { argument, benchmarkRoot, providerBinding, readJsonLines, requestFor, safeConfig, sha256 } from "./benchmark-lib.mjs";

const split = argument("--split") ?? "test";
if (!["development", "test"].includes(split)) throw new Error("--split must be development or test");
const output = resolve(argument("--output") ?? resolve(benchmarkRoot, ".runs", `${split}-requests.json`));
const configPath = argument("--provider-config");
const config = configPath ? safeConfig(configPath) : { providerId: "benchmark-provider", model: "bind-before-send", baseUrl: "http://127.0.0.1:11434/v1", locality: "local", generation: 1 };
const cases = readJsonLines(resolve(benchmarkRoot, "data", `${split}.jsonl`));
const entries = cases.map((testCase, index) => ({ caseId: testCase.caseId, language: testCase.language, category: testCase.category, request: requestFor(testCase, index, providerBinding(config)) }));
const value = { schemaVersion: "1.0.0", benchmarkClass: "development_synthetic", split, countsAsExternalEvidence: false, provider: providerBinding(config), caseCount: entries.length, entries };
const raw = `${JSON.stringify(value, null, 2)}\n`;
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, raw, "utf8");
process.stdout.write(`${JSON.stringify({ status: "exported", output, caseCount: entries.length, batchHash: sha256(raw), containsLabels: false, containsApiKey: false })}\n`);
