import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { SequenceIdFactory, researchError, type ResearchResult } from "@sestina/research";
import { openDatabase, type StorageDatabase } from "@sestina/storage";
import { createResearchStore } from "../src/index.js";
import { makeScenario, USER_SOURCE } from "./fixtures.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function ok<T>(result: ResearchResult<T>): T { if (!result.ok) throw new Error(result.error.code); return result.value; }

describe("Argument Graph SQLite repositories", () => {
  let dir: string; let db: StorageDatabase;
  beforeEach(async () => { dir = makeTempDir(); db = await openDatabase({ path: join(dir, "sestina.db") }); });
  afterEach(() => { db.close(); removeTempDir(dir); });

  it("round-trips all graph records, enforces CAS/project isolation, and never writes legacy tables", () => {
    const scenario = makeScenario(3500); const store = createResearchStore(db); const ids = new SequenceIdFactory(3600);
    ok(store.projects.create(scenario.project)); ok(store.artifacts.create(scenario.emptyArtifact)); ok(store.revisions.append(scenario.revision1)); ok(store.revisions.append(scenario.revision2));
    const claimA = { id: ids.create("rclm_"), projectId: scenario.project.id, artifactId: scenario.emptyArtifact.id, revisionId: scenario.revision2.id, kind: "causal" as const, statement: "X causes Y", source: USER_SOURCE, version: 1 };
    const claimB = { ...claimA, id: ids.create("rclm_"), kind: "mechanistic" as const, statement: "M carries the effect" };
    const evidence = { id: ids.create("revd_"), projectId: scenario.project.id, artifactId: scenario.emptyArtifact.id, revisionId: scenario.revision2.id, kind: "artifact_span" as const, summary: "Current candidate span", state: "current" as const, inferenceCapacity: "associational" as const, contentVersionHash: scenario.revision2.content.contentHash, source: USER_SOURCE, version: 1 };
    ok(store.claims.create(claimA)); ok(store.claims.create(claimB)); ok(store.argumentEvidence.create(evidence));
    const mechanism = { id: ids.create("rmec_"), projectId: scenario.project.id, artifactId: scenario.emptyArtifact.id, revisionId: scenario.revision2.id, fromClaimId: claimA.id, toClaimId: claimB.id, relation: "mediated by", intermediateSteps: ["X changes M", "M changes Y"], source: USER_SOURCE, version: 1 };
    ok(store.mechanismLinks.create(mechanism));
    const ce = { projectId: scenario.project.id, claimId: claimA.id, evidenceId: evidence.id, role: "supports" as const, status: "unproven" as const, source: USER_SOURCE, version: 1 };
    const me = { projectId: scenario.project.id, mechanismLinkId: mechanism.id, evidenceId: evidence.id, stepIndex: 0, status: "unproven" as const, source: USER_SOURCE, version: 1 };
    ok(store.claimEvidenceLinks.create(ce)); ok(store.mechanismEvidenceLinks.create(me));
    const span = (revisionId: string) => ({ projectId: scenario.project.id, artifactId: scenario.emptyArtifact.id, revisionId, normalizedTextHash: "a".repeat(64), start: 0, end: 2, quoteHash: "b".repeat(64), normalizationVersion: "nfkc-lf-v1" as const, indexUnit: "utf16_code_unit" as const });
    const delta = { id: ids.create("rdlt_"), projectId: scenario.project.id, artifactId: scenario.emptyArtifact.id, baselineRevisionId: scenario.revision1.id, candidateRevisionId: scenario.revision2.id, kind: "evidence_link" as const, baselineGapSpans: [span(scenario.revision1.id)], candidateAdditionSpans: [span(scenario.revision2.id)], relation: "The claim is now linked to current material", evidenceLinkIds: [evidence.id], limitations: [], source: USER_SOURCE, version: 1 };
    ok(store.argumentDeltas.create(delta));
    expect(ok(store.claims.getById(scenario.project.id, claimA.id))).toEqual(claimA);
    expect(ok(store.argumentEvidence.getById(scenario.project.id, evidence.id))).toEqual(evidence);
    expect(ok(store.mechanismLinks.getById(scenario.project.id, mechanism.id))).toEqual(mechanism);
    expect(ok(store.claimEvidenceLinks.get(scenario.project.id, claimA.id, evidence.id))).toEqual(ce);
    expect(ok(store.mechanismEvidenceLinks.get(scenario.project.id, mechanism.id, evidence.id))).toEqual(me);
    expect(ok(store.argumentDeltas.getById(scenario.project.id, delta.id))).toEqual(delta);
    const stale = { ...evidence, state: "stale" as const, version: 2 }; expect(store.argumentEvidence.compareAndSwap(stale, 1)).toMatchObject({ ok: true }); expect(store.argumentEvidence.compareAndSwap({ ...stale, version: 3 }, 1)).toMatchObject({ ok: false, error: { code: "version_conflict" } });
    const oldEvidence = { ...evidence, id: ids.create("revd_"), revisionId: scenario.revision1.id, contentVersionHash: scenario.revision1.content.contentHash };
    ok(store.argumentEvidence.create(oldEvidence));
    expect(store.claimEvidenceLinks.create({ ...ce, evidenceId: oldEvidence.id })).toMatchObject({ ok: false, error: { code: "invalid_evidence_link" } });
    expect(ok(store.claims.getById(new SequenceIdFactory(9991).create("rprj_"), claimA.id))).toBeUndefined();
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM situation_assertions")?.n).toBe(0); expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM evidence_items")?.n).toBe(0);
  });

  it("rolls back Argument Graph writes through the shared Unit of Work", () => {
    const scenario = makeScenario(3700); const store = createResearchStore(db); ok(store.projects.create(scenario.project)); ok(store.artifacts.create(scenario.emptyArtifact)); ok(store.revisions.append(scenario.revision1));
    const claim = { id: scenario.ids.create("rclm_"), projectId: scenario.project.id, artifactId: scenario.emptyArtifact.id, revisionId: scenario.revision1.id, kind: "descriptive" as const, statement: "Observed pattern", source: USER_SOURCE, version: 1 };
    const result = store.unitOfWork.commit((repositories) => { const created = repositories.claims.create(claim); if (!created.ok) return created; return { ok: false, error: researchError("invalid_claim") }; });
    expect(result).toMatchObject({ ok: false }); expect(ok(store.claims.getById(scenario.project.id, claim.id))).toBeUndefined();
  });
});
