import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openFrozenProjectReader } from "../src/project-reader.js";

const roots: string[] = [];

function payload() {
  return {
    schemaVersion: "1.0.0",
    contentBoundary: {
      kind: "untrusted_research_data",
      authority: "none",
      mayDirectTools: false,
      grantsPermissions: false,
      representsUserAcceptance: false,
      representsAdjudication: false,
      representsTaskCompletion: false,
    },
    manifestBinding: {
      pilotId: "rpil_00000000000000000000000000",
      attemptId: "rpat_00000000000000000000000000",
      manifestId: "rman_00000000000000000000000000",
      projectId: "rprj_00000000000000000000000000",
      host: "codex",
      purpose: "candidate_generation",
    },
    projectStateHash: "a".repeat(64),
    brief: { id: "rbrf_00000000000000000000000000", versionId: "rbrf_00000000000000000000000001", version: 1, projectQuestion: "Synthetic question" },
    episode: { id: "repi_00000000000000000000000000", version: 1, status: "active" },
    currentTask: "Review one bounded synthetic claim.",
    decisions: [], issues: [], evidence: [], workingMemory: [],
  } as const;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => { await rm(root, { recursive: true, force: true }); }));
});

describe("RI-52 frozen invocation-only MCP projection", () => {
  it("returns exactly the user-previewed UTF-8 bytes and exposes only a minimal audit binding", async () => {
    const root = await mkdtemp(join(tmpdir(), "sestina-ri52-frozen-reader-")); roots.push(root);
    const contextFile = join(root, "context.json");
    const json = JSON.stringify(payload());
    const hash = createHash("sha256").update(json, "utf8").digest("hex");
    await writeFile(contextFile, json, "utf8");
    const opened = await openFrozenProjectReader({
      contextFile,
      expectedProjectId: payload().manifestBinding.projectId,
      expectedManifestHash: hash,
      outputLimitBytes: 65_536,
      queryTimeoutMs: 2_000,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const serialized = await opened.value.readSerializedResearchContext();
    expect(serialized).toEqual({ ok: true, value: { payload: payload(), json, bytes: Buffer.byteLength(json, "utf8") } });
    expect(opened.value.auditBinding?.()).toEqual({
      projectId: payload().manifestBinding.projectId,
      manifestHash: hash,
      payloadHash: hash,
    });
    opened.value.close();
    expect(await opened.value.readSerializedResearchContext()).toMatchObject({ ok: false, error: { code: "project_state_unavailable" } });
  });

  it("fails closed for tampering, a cross-project binding, a relative path, and an oversized payload", async () => {
    const root = await mkdtemp(join(tmpdir(), "sestina-ri52-frozen-reader-invalid-")); roots.push(root);
    const contextFile = join(root, "context.json");
    const json = JSON.stringify(payload());
    const hash = createHash("sha256").update(json, "utf8").digest("hex");
    await writeFile(contextFile, json, "utf8");
    await expect(openFrozenProjectReader({ contextFile: "context.json", expectedProjectId: payload().manifestBinding.projectId, expectedManifestHash: hash, outputLimitBytes: 65_536, queryTimeoutMs: 2_000 })).resolves.toMatchObject({ ok: false });
    await expect(openFrozenProjectReader({ contextFile, expectedProjectId: "rprj_11111111111111111111111111", expectedManifestHash: hash, outputLimitBytes: 65_536, queryTimeoutMs: 2_000 })).resolves.toMatchObject({ ok: false });
    await expect(openFrozenProjectReader({ contextFile, expectedProjectId: payload().manifestBinding.projectId, expectedManifestHash: "b".repeat(64), outputLimitBytes: 65_536, queryTimeoutMs: 2_000 })).resolves.toMatchObject({ ok: false });
    const oversizedPayload = { ...payload(), currentTask: "x".repeat(2_000) };
    const oversizedJson = JSON.stringify(oversizedPayload);
    const oversizedHash = createHash("sha256").update(oversizedJson, "utf8").digest("hex");
    await writeFile(contextFile, oversizedJson, "utf8");
    await expect(openFrozenProjectReader({ contextFile, expectedProjectId: payload().manifestBinding.projectId, expectedManifestHash: oversizedHash, outputLimitBytes: 1_024, queryTimeoutMs: 2_000 })).resolves.toMatchObject({ ok: false, error: { code: "response_too_large" } });
  });
});
