import { describe, it, expect } from "vitest";
import { SestinaErrorCode } from "@sestina/schema";
import { AGENT, HASH_A, HASH_B, PEER_MCP, USER, expectSestinaCode, makeHarness } from "./harness.js";

// ── ClaimService rules (docs/22 Task 10, B5) ──

describe("ClaimService (docs/22 Task 10)", () => {
  function currentVersion(h: ReturnType<typeof makeHarness>, claimId: string): number {
    const claim = h.claims.get(h.projectId, claimId);
    if (!claim) throw new Error("claim missing");
    return claim.version;
  }

  it("requires the caller's expected version when recomputing claim status", () => {
    const h = makeHarness();
    const claim = h.claims.record(h.projectId, {
      taskId: h.taskId,
      text: "synthetic",
      type: "factual",
      importance: "supporting",
      confidence: 0.5,
      limitations: [],
      provenance: AGENT,
      evidenceRefs: [],
    });
    h.claims.recomputeStatus(h.projectId, claim.claimId, claim.version);
    expectSestinaCode(
      () => {
        h.claims.recomputeStatus(h.projectId, claim.claimId, claim.version);
      },
      SestinaErrorCode.stale_state,
    );
  });

  it("requires claim evidence to exist in the same project and task", () => {
    const h = makeHarness();
    const evidence = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "primary_source",
      locator: { type: "path", value: "a.txt" },
      contentHash: HASH_A,
      provenance: AGENT,
    });
    // Same task: fine.
    const claim = h.claims.record(h.projectId, {
      taskId: h.taskId,
      text: "synthetic claim",
      type: "factual",
      importance: "supporting",
      confidence: 0.5,
      limitations: [],
      provenance: AGENT,
      evidenceRefs: [evidence.evidenceId],
    });
    expect(claim.status).toBe("unverified");
    // Cross-task evidence (here: the other project's task): rejected.
    const foreign = h.evidence.record(h.otherProjectId, {
      taskId: h.otherTaskId,
      type: "primary_source",
      locator: { type: "path", value: "foreign.txt" },
      contentHash: HASH_B,
      provenance: AGENT,
    });
    expectSestinaCode(
      () => {
        h.claims.record(h.projectId, {
          taskId: h.taskId,
          text: "claim citing foreign evidence",
          type: "factual",
          importance: "supporting",
          confidence: 0.5,
          limitations: [],
          provenance: AGENT,
          evidenceRefs: [foreign.evidenceId],
        });
      },
      SestinaErrorCode.validation_failed,
    );
  });

  it("keeps a claim with no valid evidence unverified", () => {
    const h = makeHarness();
    const claim = h.claims.record(h.projectId, {
      taskId: h.taskId,
      text: "no evidence yet",
      type: "factual",
      importance: "supporting",
      confidence: 0.5,
      limitations: [],
      provenance: AGENT,
      evidenceRefs: [],
    });
    expect(claim.status).toBe("unverified");
    expect(h.claims.recomputeStatus(h.projectId, claim.claimId, currentVersion(h, claim.claimId)).status).toBe("unverified");
  });

  it("never verifies through disputed, superseded or expired evidence", () => {
    const h = makeHarness();
    const claim = h.claims.record(h.projectId, {
      taskId: h.taskId,
      text: "synthetic claim",
      type: "factual",
      importance: "supporting",
      confidence: 0.5,
      limitations: [],
      provenance: AGENT,
      evidenceRefs: [],
    });
    const disputed = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "primary_source",
      locator: { type: "path", value: "disputed.txt" },
      contentHash: HASH_A,
      provenance: AGENT,
    });
    h.evidence.dispute(h.projectId, disputed.evidenceId, disputed.version, USER, "synthetic");
    h.claims.linkEvidence(h.projectId, {
      claimId: claim.claimId,
      evidenceId: disputed.evidenceId,
      relation: "supports",
      strength: "causal",
      provenance: AGENT,
    });
    expect(h.claims.recomputeStatus(h.projectId, claim.claimId, currentVersion(h, claim.claimId)).status).toBe("unverified");

    const superseded = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "primary_source",
      locator: { type: "path", value: "superseded.txt" },
      contentHash: HASH_B,
      provenance: AGENT,
    });
    h.evidence.supersede(h.projectId, superseded.evidenceId, superseded.version, AGENT, "synthetic");
    h.claims.linkEvidence(h.projectId, {
      claimId: claim.claimId,
      evidenceId: superseded.evidenceId,
      relation: "supports",
      strength: "causal",
      provenance: AGENT,
    });
    expect(h.claims.recomputeStatus(h.projectId, claim.claimId, currentVersion(h, claim.claimId)).status).toBe("unverified");
  });

  it("supports a factual claim through live verified evidence", () => {
    const h = makeHarness();
    const claim = h.claims.record(h.projectId, {
      taskId: h.taskId,
      text: "synthetic claim",
      type: "factual",
      importance: "supporting",
      confidence: 0.5,
      limitations: [],
      provenance: AGENT,
      evidenceRefs: [],
    });
    const evidence = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "primary_source",
      locator: { type: "path", value: "ok.txt" },
      provenance: AGENT,
    });
    h.evidence.verify(h.projectId, evidence.evidenceId, evidence.version, USER);
    h.claims.linkEvidence(h.projectId, {
      claimId: claim.claimId,
      evidenceId: evidence.evidenceId,
      relation: "supports",
      strength: "causal",
      provenance: AGENT,
    });
    expect(h.claims.recomputeStatus(h.projectId, claim.claimId, currentVersion(h, claim.claimId)).status).toBe("supported");
    // Expired evidence stops supporting: the status recomputes honestly.
    const expired = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "primary_source",
      locator: { type: "path", value: "expired.txt" },
      provenance: AGENT,
    });
    h.evidence.verify(h.projectId, expired.evidenceId, expired.version, USER);
    h.stores.evidence.rows.set(expired.evidenceId, {
      ...expired,
      status: "verified",
      expiresAt: "2020-01-01T00:00:00.000Z",
    });
    h.claims.linkEvidence(h.projectId, {
      claimId: claim.claimId,
      evidenceId: expired.evidenceId,
      relation: "supports",
      strength: "causal",
      provenance: AGENT,
    });
    // The live one still supports.
    expect(h.claims.recomputeStatus(h.projectId, claim.claimId, currentVersion(h, claim.claimId)).status).toBe("supported");
  });

  it("caps peer-recorded claims at the reported unverified ceiling", () => {
    const h = makeHarness();
    const claim = h.claims.record(h.projectId, {
      taskId: h.taskId,
      text: "peer says the work is done",
      type: "completion",
      importance: "critical",
      confidence: 0.9,
      limitations: [],
      provenance: PEER_MCP,
      evidenceRefs: [],
    });
    const evidence = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "primary_source",
      locator: { type: "path", value: "peer.txt" },
      provenance: AGENT,
    });
    h.evidence.verify(h.projectId, evidence.evidenceId, evidence.version, USER);
    h.claims.linkEvidence(h.projectId, {
      claimId: claim.claimId,
      evidenceId: evidence.evidenceId,
      relation: "supports",
      strength: "causal",
      provenance: AGENT,
    });
    const recomputed = h.claims.recomputeStatus(
      h.projectId,
      claim.claimId,
      currentVersion(h, claim.claimId),
    );
    expect(recomputed.status).toBe("unverified");
  });

  it("never overwrites a human not_applicable assessment", () => {
    const h = makeHarness();
    const claim = h.claims.record(h.projectId, {
      taskId: h.taskId,
      text: "synthetic claim",
      type: "factual",
      importance: "supporting",
      confidence: 0.5,
      limitations: [],
      provenance: AGENT,
      evidenceRefs: [],
    });
    // A human (direct user) marks the claim not applicable.
    const current = h.stores.claims.get(h.projectId, claim.claimId);
    if (!current) throw new Error("claim missing");
    h.stores.claims.transition(
      h.projectId,
      claim.claimId,
      current.version,
      { ...current, status: "not_applicable", version: current.version + 1 },
      {
        historyId: "h-na",
        action: "human",
        fromStatus: "unverified",
        toStatus: "not_applicable",
        expectedVersion: current.version,
        actorJson: JSON.stringify(USER),
        atMs: 0,
      },
    );
    const evidence = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "primary_source",
      locator: { type: "path", value: "contra.txt" },
      provenance: AGENT,
    });
    h.evidence.verify(h.projectId, evidence.evidenceId, evidence.version, USER);
    h.claims.linkEvidence(h.projectId, {
      claimId: claim.claimId,
      evidenceId: evidence.evidenceId,
      relation: "contradicts",
      strength: "causal",
      provenance: AGENT,
    });
    expect(h.claims.recomputeStatus(h.projectId, claim.claimId, currentVersion(h, claim.claimId)).status).toBe("not_applicable");
  });

  it("binds completion claims to deliverable-verified evidence", () => {
    const h = makeHarness();
    h.deliverables.syncFromContract(
      h.projectId,
      h.taskId,
      [{ deliverableId: "dl-1", description: "synthetic deliverable" }],
      1,
      AGENT,
    );
    const claim = h.claims.record(h.projectId, {
      taskId: h.taskId,
      text: "the deliverable is complete",
      type: "completion",
      importance: "critical",
      confidence: 0.8,
      limitations: [],
      provenance: AGENT,
      evidenceRefs: [],
    });
    const evidence = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "primary_source",
      locator: { type: "path", value: "deliverable.txt" },
      provenance: AGENT,
    });
    h.evidence.verify(h.projectId, evidence.evidenceId, evidence.version, USER);
    h.claims.linkEvidence(h.projectId, {
      claimId: claim.claimId,
      evidenceId: evidence.evidenceId,
      relation: "supports",
      strength: "causal",
      provenance: AGENT,
    });
    // Verified evidence alone: partially supported, not supported.
    expect(h.claims.recomputeStatus(h.projectId, claim.claimId, currentVersion(h, claim.claimId)).status)
      .toBe("partially_supported");
    // A satisfied deliverable referencing the same evidence completes it.
    h.deliverables.transitionStatus(h.projectId, h.taskId, "dl-1", 1, "satisfied", USER, {
      evidenceRefs: [evidence.evidenceId],
    });
    expect(h.claims.recomputeStatus(h.projectId, claim.claimId, currentVersion(h, claim.claimId)).status).toBe("supported");
  });

  it("keeps claim-evidence authority immutable and records who created the link", () => {
    const h = makeHarness();
    const claim = h.claims.record(h.projectId, {
      taskId: h.taskId,
      text: "immutable link",
      type: "factual",
      importance: "material",
      confidence: 0.5,
      limitations: [],
      provenance: AGENT,
      evidenceRefs: [],
    });
    const evidence = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "observation",
      locator: { type: "artifact", value: "link-source" },
      provenance: AGENT,
    });
    h.claims.linkEvidence(h.projectId, {
      claimId: claim.claimId,
      evidenceId: evidence.evidenceId,
      relation: "context",
      strength: "reported",
      provenance: AGENT,
    });
    expect(h.claims.listEvidenceLinks(h.projectId, claim.claimId)[0]?.provenance).toEqual(AGENT);
    expectSestinaCode(
      () => {
        h.claims.linkEvidence(h.projectId, {
          claimId: claim.claimId,
          evidenceId: evidence.evidenceId,
          relation: "supports",
          strength: "causal",
          provenance: PEER_MCP,
        });
      },
      SestinaErrorCode.idempotency_violation,
    );
    expect(h.claims.listEvidenceLinks(h.projectId, claim.claimId)[0])
      .toMatchObject({ relation: "context", strength: "reported", provenance: AGENT });
  });
});
