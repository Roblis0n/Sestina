import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");
const BENCHMARK = resolve(ROOT, "researchbench", "research-room-semantic-judge");
const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const readJson = async (path: string): Promise<Record<string, unknown>> => JSON.parse(await readFile(resolve(BENCHMARK, path), "utf8")) as Record<string, unknown>;
const readJsonLines = async (path: string): Promise<Record<string, unknown>[]> => (await readFile(resolve(BENCHMARK, path), "utf8"))
  .split(/\r?\n/u).filter((line) => line.trim()).map((line) => JSON.parse(line) as Record<string, unknown>);

describe("Research Room Semantic Judge development benchmark lock", () => {
  it("keeps development and locked test records disjoint, balanced, synthetic, and label-consistent", async () => {
    const development = await readJsonLines("data/development.jsonl");
    const test = await readJsonLines("data/test.jsonl");
    expect(development).toHaveLength(96);
    expect(test).toHaveLength(96);
    expect(new Set([...development, ...test].map((item) => item.caseId)).size).toBe(192);
    const developmentSuggestions = new Set(development.map((item) => item.suggestion));
    expect(test.every((item) => !developmentSuggestions.has(item.suggestion))).toBe(true);

    for (const [split, records] of [["development", development], ["test", test]] as const) {
      expect(records.every((item) => item.split === split && item.syntheticOnly === true && item.countsAsExternalEvidence === false)).toBe(true);
      expect(records.filter((item) => item.language === "zh-CN")).toHaveLength(48);
      expect(records.filter((item) => item.language === "en")).toHaveLength(48);
      const categories = new Set(records.map((item) => item.category));
      expect(categories.size).toBe(12);
      for (const category of categories) {
        const selected = records.filter((item) => item.category === category);
        expect(selected).toHaveLength(8);
        expect(new Set(selected.map((item) => item.variant))).toEqual(new Set(["positive", "hard-negative", "boundary", "missing-context"]));
      }
    }

    const reasonable = test.find((item) => item.category === "reasonable-increment" && item.variant === "positive");
    const substantive = test.find((item) => item.category === "substantive-argument-delta" && item.variant === "positive");
    expect(reasonable?.label).toMatchObject({ targetCriterion: "argument-delta", criterionVerdict: "positive", intervention: false, reasonableIncrement: "supported" });
    expect(substantive?.label).toMatchObject({ targetCriterion: "argument-delta", criterionVerdict: "positive", intervention: false, reasonableIncrement: "supported" });
  });

  it("binds every locked input by hash and preserves honest blocked evidence status", async () => {
    const lock = await readJson("lock/test-lock.json");
    const files = lock.files as Record<string, { path: string; sha256: string }>;
    for (const entry of Object.values(files)) expect(sha256(await readFile(resolve(BENCHMARK, entry.path), "utf8"))).toBe(entry.sha256);
    const { lockHash: _lockHash, ...payload } = lock;
    void _lockHash;
    expect(sha256(`${JSON.stringify(payload, null, 2)}\n`)).toBe(lock.lockHash);
    expect(lock).toMatchObject({ benchmarkClass: "development_synthetic", lockedBeforeAnyProviderRun: true, caseCount: 96, categoryCount: 12 });

    const aggregate = await readJson("reports/aggregate.json");
    expect(aggregate).toMatchObject({ status: "blocked_missing_user_config", decision: "unproven", metrics: null, failureCases: [], realProviderHostSmoke: "blocked_missing_user_config", developmentSemanticMetrics: "blocked_missing_user_config", externalUserUsability: "unproven", realSecondUse: "unproven", marketEvidence: "unproven", testLockHash: lock.lockHash });
    const protocol = await readJsonLines("data/protocol-adversarial.jsonl");
    expect(new Set(protocol.map((item) => item.mutation))).toEqual(new Set(["markdown_fence", "extra_field", "missing_criterion", "duplicate_criterion", "span_offset", "request_hash_mismatch", "authority_field", "forged_decision_id", "forged_receipt", "overlong_input", "overlong_response"]));
    expect(protocol.every((item) => item.acceptedAuthorityMutation === false)).toBe(true);
  });

  it("exports without labels, imports strict failures without raw responses, and does not invent a live-host smoke", async () => {
    const temporary = await mkdtemp(resolve(tmpdir(), "sestina-semantic-benchmark-"));
    const viteNode = resolve(ROOT, "node_modules", "vite-node", "vite-node.mjs");
    const batchPath = resolve(temporary, "requests.json");
    const responsesPath = resolve(temporary, "responses.jsonl");
    const predictionsPath = resolve(temporary, "predictions.jsonl");
    const reportPath = resolve(temporary, "aggregate.json");
    const failuresPath = resolve(temporary, "failures.json");
    try {
      const exported = spawnSync(process.execPath, [viteNode, resolve(BENCHMARK, "tools", "export-requests.mjs"), "--split", "test", "--output", batchPath], { cwd: ROOT, encoding: "utf8" });
      expect(exported.status, exported.stderr).toBe(0);
      const batchRaw = await readFile(batchPath, "utf8");
      const batch = JSON.parse(batchRaw) as { entries: { caseId: string }[]; caseCount: number; countsAsExternalEvidence: boolean };
      expect(batch).toMatchObject({ caseCount: 96, countsAsExternalEvidence: false });
      expect(batchRaw).not.toMatch(/"label"\s*:/u);

      const secretMarker = "raw-provider-secret-must-not-persist";
      await writeFile(responsesPath, batch.entries.map((entry) => JSON.stringify({ caseId: entry.caseId, response: JSON.stringify({ apiKey: secretMarker }), latencyMs: 1, callCount: 1, costUsd: null })).join("\n") + "\n", "utf8");
      const imported = spawnSync(process.execPath, [viteNode, resolve(BENCHMARK, "tools", "import-responses.mjs"), "--requests", batchPath, "--responses", responsesPath, "--output", predictionsPath], { cwd: ROOT, encoding: "utf8" });
      expect(imported.status, imported.stderr).toBe(0);
      const predictionRaw = await readFile(predictionsPath, "utf8");
      const predictions = predictionRaw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(predictions).toHaveLength(96);
      expect(predictions.every((item) => item.status === "invalid_response" && (item.provenance as Record<string, unknown>).executionMode === "imported_response")).toBe(true);
      expect(predictionRaw).not.toContain(secretMarker);
      expect(predictionRaw).not.toMatch(/"response"\s*:/u);

      const evaluated = spawnSync(process.execPath, [viteNode, resolve(BENCHMARK, "tools", "evaluate.mjs"), "--split", "test", "--predictions", predictionsPath, "--report", reportPath, "--failures", failuresPath], { cwd: ROOT, encoding: "utf8" });
      expect(evaluated.status, evaluated.stderr).toBe(0);
      expect(JSON.parse(await readFile(reportPath, "utf8"))).toMatchObject({ status: "evaluated", decision: "development_semantic_no_go", realProviderHostSmoke: "unproven_from_imported_or_baseline", externalUserUsability: "unproven" });
      expect((JSON.parse(await readFile(failuresPath, "utf8")) as { failureCases: unknown[] }).failureCases).toHaveLength(96);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }, 30_000);
});
