import { describe, it, expect } from "vitest";
import { AGENT, USER, makeHarness } from "./harness.js";

// ── Causal claim rules (docs/22 Task 10: correlational-only evidence never
// fully supports a causal claim) ──

describe("Causal claim evidence strength (docs/22 Task 10)", () => {
  function currentVersion(h: ReturnType<typeof makeHarness>, claimId: string): number {
    const claim = h.claims.get(h.projectId, claimId);
    if (!claim) throw new Error("claim missing");
    return claim.version;
  }

  function causalClaim(h: ReturnType<typeof makeHarness>) {
    return h.claims.record(h.projectId, {
      taskId: h.taskId,
      text: "X caused Y",
      type: "causal",
      importance: "material",
      confidence: 0.6,
      limitations: [],
      provenance: AGENT,
      evidenceRefs: [],
    });
  }

  function verifiedEvidence(h: ReturnType<typeof makeHarness>, name: string) {
    const item = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "primary_source",
      locator: { type: "path", value: name },
      provenance: AGENT,
    });
    h.evidence.verify(h.projectId, item.evidenceId, item.version, USER);
    return item;
  }

  it("correlational-only support caps a causal claim at partially_supported", () => {
    const h = makeHarness();
    const claim = causalClaim(h);
    const evidence = verifiedEvidence(h, "correlation.txt");
    h.claims.linkEvidence(h.projectId, {
      claimId: claim.claimId,
      evidenceId: evidence.evidenceId,
      relation: "supports",
      strength: "correlational",
      provenance: AGENT,
    });
    expect(h.claims.recomputeStatus(h.projectId, claim.claimId, currentVersion(h, claim.claimId)).status)
      .toBe("partially_supported");
    // More correlational evidence does not change the ceiling.
    const more = verifiedEvidence(h, "correlation-2.txt");
    h.claims.linkEvidence(h.projectId, {
      claimId: claim.claimId,
      evidenceId: more.evidenceId,
      relation: "supports",
      strength: "correlational",
      provenance: AGENT,
    });
    expect(h.claims.recomputeStatus(h.projectId, claim.claimId, currentVersion(h, claim.claimId)).status)
      .toBe("partially_supported");
  });

  it("causal-strength verified support reaches supported", () => {
    const h = makeHarness();
    const claim = causalClaim(h);
    const evidence = verifiedEvidence(h, "causal.txt");
    h.claims.linkEvidence(h.projectId, {
      claimId: claim.claimId,
      evidenceId: evidence.evidenceId,
      relation: "supports",
      strength: "causal",
      provenance: AGENT,
    });
    expect(h.claims.recomputeStatus(h.projectId, claim.claimId, currentVersion(h, claim.claimId)).status).toBe("supported");
  });

  it("mixed causal and correlational support reaches supported", () => {
    const h = makeHarness();
    const claim = causalClaim(h);
    const causal = verifiedEvidence(h, "causal.txt");
    const correlational = verifiedEvidence(h, "correlation.txt");
    h.claims.linkEvidence(h.projectId, {
      claimId: claim.claimId,
      evidenceId: correlational.evidenceId,
      relation: "supports",
      strength: "correlational",
      provenance: AGENT,
    });
    h.claims.linkEvidence(h.projectId, {
      claimId: claim.claimId,
      evidenceId: causal.evidenceId,
      relation: "supports",
      strength: "causal",
      provenance: AGENT,
    });
    expect(h.claims.recomputeStatus(h.projectId, claim.claimId, currentVersion(h, claim.claimId)).status).toBe("supported");
  });

  it("a verified contradiction projects to contradicted", () => {
    const h = makeHarness();
    const claim = causalClaim(h);
    const support = verifiedEvidence(h, "support.txt");
    const contradiction = verifiedEvidence(h, "contra.txt");
    h.claims.linkEvidence(h.projectId, {
      claimId: claim.claimId,
      evidenceId: support.evidenceId,
      relation: "supports",
      strength: "causal",
      provenance: AGENT,
    });
    h.claims.linkEvidence(h.projectId, {
      claimId: claim.claimId,
      evidenceId: contradiction.evidenceId,
      relation: "contradicts",
      strength: "causal",
      provenance: AGENT,
    });
    expect(h.claims.recomputeStatus(h.projectId, claim.claimId, currentVersion(h, claim.claimId)).status).toBe("contradicted");
  });

  it("an unverified contradiction does not contradict", () => {
    const h = makeHarness();
    const claim = causalClaim(h);
    const unverified = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "primary_source",
      locator: { type: "path", value: "unverified-contra.txt" },
      provenance: AGENT,
    });
    h.claims.linkEvidence(h.projectId, {
      claimId: claim.claimId,
      evidenceId: unverified.evidenceId,
      relation: "contradicts",
      strength: "causal",
      provenance: AGENT,
    });
    expect(h.claims.recomputeStatus(h.projectId, claim.claimId, currentVersion(h, claim.claimId)).status).toBe("unverified");
  });
});
