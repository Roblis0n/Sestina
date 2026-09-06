import { afterEach, describe, expect, it } from "vitest";
import { openSestina } from "@sestina/core";
import { openDatabase } from "@sestina/storage";
import { SyntheticProvider, syntheticProject, USER, value } from "../factory.js";

const states: Awaited<ReturnType<typeof syntheticProject>>[] = [];
async function fixture(provider?: SyntheticProvider) { const s = await syntheticProject(provider); states.push(s); return s; }
async function analyze(s: Awaited<ReturnType<typeof fixture>>) { const p = s.prepare(); return value(await s.core.analyzeResearchRoomSuggestion({ reviewId: p.reviewId, confirmationNonce: p.confirmationNonce, manifestHash: p.manifestHash })); }
afterEach(async () => { for (const s of states.splice(0)) await s.cleanup(); });

describe("accepted target / downstream RED / no expected-failure masking", () => {
  it.each(["accepted", "modified_accepted"] as const)("P0-01 G4: generic %s cannot substitute a receipt for a typed object effect", async (disposition) => {
    const s = await fixture(new SyntheticProvider()); const r = await analyze(s);
    const result = s.core.commitResearchRoomDisposition({ projectId: s.projectId, reviewId: r.reviewId, authorityNonce: r.authorityNonce, expectedStateBinding: r.stateBinding, disposition, reason: "Synthetic user choice", actor: USER, modifiedProposal: "Bound the synthetic claim." });
    expect(result.ok, "Generic acceptance has no typed target; it must fail instead of recording an apparent research result.").toBe(false);
  });
  it.each([undefined, "failure", "invalid"] as const)("P1-01/P1-03 G4: unavailable assessment (%s) cannot veto a user decision", async (mode) => {
    const s = await fixture(mode === undefined ? undefined : new SyntheticProvider(mode)); const r = await analyze(s);
    const result = s.core.commitResearchRoomDisposition({ projectId: s.projectId, reviewId: r.reviewId, authorityNonce: r.authorityNonce, expectedStateBinding: r.stateBinding, disposition: "direction_changed", redirectQuestion: "Which synthetic limitation needs investigation?", reason: "The user changes research direction independently of an assessment.", actor: USER });
    expect(result.ok, "A valid user direction change is blocked only because the Provider is unavailable.").toBe(true);
  });
  it("P0-01 G5: B record-only invalidates A's earlier outbound confirmation", async () => {
    const provider = new SyntheticProvider(); const s = await fixture(provider); const a = s.prepare(); const b = await analyze(s);
    value(s.core.commitResearchRoomDisposition({ projectId: s.projectId, reviewId: b.reviewId, authorityNonce: b.authorityNonce, expectedStateBinding: b.stateBinding, disposition: "deferred", reason: "Record this outcome.", actor: USER }));
    const calls = provider.calls.length;
    const result = await s.core.analyzeResearchRoomSuggestion({ reviewId: a.reviewId, confirmationNonce: a.confirmationNonce, manifestHash: a.manifestHash });
    expect({ accepted: result.ok, additionalSends: provider.calls.length - calls }, "Review history changed the snapshot; old consent must permit zero sends.").toEqual({ accepted: false, additionalSends: 0 });
  });
  it("P1-02 G5: valid protocol plus unrelated rationale is not semantic readiness", async () => {
    const s = await fixture(new SyntheticProvider()); const r = await analyze(s);
    expect(r.providerStatus, "Schema and quote checks cannot certify semantic correctness.").not.toBe("semantic_ready");
  });
  it("P1-05 G5: prepared interactive Review survives a restart", async () => {
    const s = await fixture(); const p = s.prepare(); s.core.close();
    const reopened = value(await openSestina({ databasePath: s.databasePath }));
    try {
      const db = await openDatabase({ path: s.databasePath, readOnly: true });
      try {
        const tables = db.all<{ name: string }>("SELECT name FROM sqlite_schema WHERE type='table'");
        // Inventory assertion is a real absence result, not a missing-table exception.
        expect(tables.map((x) => x.name), `Prepared ${p.reviewId} is lost when the in-memory map exits.`).toContain("research_reviews");
      } finally { db.close(); }
    } finally { reopened.close(); }
  });
});
