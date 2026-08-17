import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ClaimSchema,
  EvidenceItemSchema,
} from "@sestina/schema";
import { AGENT, USER, makeHarness } from "./harness.js";

// ── Cleanup/expiry behaviour + shared fixtures (docs/22 Task 10) ──

describe("Evidence cleanup and expiry (docs/22 Task 10)", () => {
  it("expired evidence stops supporting claims on the next recompute", () => {
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
      locator: { type: "path", value: "a.txt" },
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
    expect(h.claims.recomputeStatus(h.projectId, claim.claimId, claim.version).status).toBe("supported");
    // Retention clears the excerpt; the row survives but the liveness check
    // in recompute reads the stored row, so simulate the stored state.
    const stored = h.stores.evidence.rows.get(evidence.evidenceId);
    if (!stored) throw new Error("evidence missing");
    h.stores.evidence.rows.set(evidence.evidenceId, {
      ...stored,
      status: "verified",
      expiresAt: "2020-01-01T00:00:00.000Z",
    });
    expect(h.claims.recomputeStatus(h.projectId, claim.claimId, claim.version + 1).status).toBe("unverified");
  });

  it("retention-cleared evidence (no excerpt, no data keys) still parses", () => {
    const h = makeHarness();
    const evidence = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "primary_source",
      locator: { type: "path", value: "a.txt" },
      excerpt: "sensitive-synthetic",
      provenance: AGENT,
    });
    // Simulate the retention clear: excerpt gone from the item.
    const stored = h.stores.evidence.rows.get(evidence.evidenceId);
    if (!stored) throw new Error("evidence missing");
    const cleared: typeof stored = { ...stored, excerpt: undefined };
    expect(EvidenceItemSchema.safeParse(cleared).success).toBe(true);
  });
});

describe("Shared evidence fixtures (tests/fixtures/evidence)", () => {
  const FIXTURES = resolve(import.meta.dirname, "../../../tests/fixtures/evidence");

  it("valid-evidence-item.json parses as an EvidenceItem", () => {
    const raw = JSON.parse(
      readFileSync(resolve(FIXTURES, "valid-evidence-item.json"), "utf8"),
    ) as unknown;
    const parsed = EvidenceItemSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
  });

  it("valid-claim.json parses as a Claim", () => {
    const raw = JSON.parse(
      readFileSync(resolve(FIXTURES, "valid-claim.json"), "utf8"),
    ) as unknown;
    const parsed = ClaimSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
  });
});
