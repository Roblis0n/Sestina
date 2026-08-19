import { describe, expect, it } from "vitest";
import { SequenceIdFactory, type ArgumentClaim, type ArgumentEvidence, type ClaimEvidenceLink, type ResearchSource } from "@sestina/research";
import { evaluateEvidenceBoundary, evaluateEvidenceFreshness } from "../src/index.js";

const ids = new SequenceIdFactory(3800); const projectId = ids.create("rprj_"); const artifactId = ids.create("rart_"); const revisionId = ids.create("rrev_");
const source: ResearchSource = { actor: { kind: "user", actorId: "lead" }, authority: "user_recorded", recordedAt: "2026-08-19T11:00:00.000Z" };
function claim(kind: ArgumentClaim["kind"]): ArgumentClaim { return { id: ids.create("rclm_"), projectId, artifactId, revisionId, kind, statement: "X causes Y", source, version: 1 }; }
function evidence(kind: ArgumentEvidence["kind"], capacity: ArgumentEvidence["inferenceCapacity"], state: ArgumentEvidence["state"] = "current"): ArgumentEvidence { return { id: ids.create("revd_"), projectId, artifactId, revisionId, kind, summary: "registered evidence", state, inferenceCapacity: capacity, contentVersionHash: "a".repeat(64), source, version: 1 }; }
function link(c: ArgumentClaim, e: ArgumentEvidence, role: ClaimEvidenceLink["role"] = "supports"): ClaimEvidenceLink { return { projectId, claimId: c.id, evidenceId: e.id, role, status: e.state === "stale" ? "stale" : "proven", source, version: 1 }; }

describe("Claim–Evidence–Mechanism boundary", () => {
  it("marks a causal claim with associational evidence unproven and supplies a minimal downgrade", () => {
    const c = claim("causal"); const e = evidence("quantitative_result", "associational");
    const result = evaluateEvidenceBoundary({ claims: [c], evidence: [e], claimEvidenceLinks: [link(c, e)], mechanismLinks: [], mechanismEvidenceLinks: [] });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.value.findings).toContainEqual(expect.objectContaining({ claimId: c.id, evidenceIds: [e.id], state: "unproven", minimumDowngrade: "State an association rather than a causal effect." }));
  });

  it("keeps background literature, user decisions and stale spans inside their evidence boundaries", () => {
    const empirical = claim("causal"); const literature = evidence("literature_source", "background_only");
    const descriptive = claim("descriptive"); const decision = evidence("user_decision", "normative");
    const stale = evidence("artifact_span", "descriptive", "stale");
    const result = evaluateEvidenceBoundary({ claims: [empirical, descriptive], evidence: [literature, decision, stale], claimEvidenceLinks: [link(empirical, literature, "background_only"), link(descriptive, decision), link(descriptive, stale)], mechanismLinks: [], mechanismEvidenceLinks: [] });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.value.findings.map((item) => item.code)).toEqual(expect.arrayContaining(["background_cannot_prove_study_claim", "user_decision_is_not_external_fact", "stale_evidence"]));
    expect(result.value.findings.every((item) => item.state !== "false")).toBe(true);
  });

  it("identifies missing mechanism steps instead of treating a theory name as a mechanism", () => {
    const c = claim("mechanistic"); const e = evidence("literature_source", "background_only");
    const result = evaluateEvidenceBoundary({ claims: [c], evidence: [e], claimEvidenceLinks: [link(c, e, "background_only")], mechanismLinks: [], mechanismEvidenceLinks: [] });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.value.findings).toContainEqual(expect.objectContaining({ code: "mechanism_step_missing", claimId: c.id, state: "unproven" }));
  });

  it("detects evidence bound to an old artifact revision deterministically", () => {
    const currentRevisionId = ids.create("rrev_"); const stale = evidence("artifact_span", "descriptive");
    expect(evaluateEvidenceFreshness([stale], [{ projectId, artifactId, revisionId: currentRevisionId, contentHash: "b".repeat(64) }])).toEqual([{ evidenceId: stale.id, reason: "revision_superseded", state: "stale" }]);
  });
});
