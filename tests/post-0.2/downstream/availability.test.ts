import { it, expect } from "vitest";
import { openDatabase } from "@sestina/storage";
import { SyntheticProvider, syntheticProject, USER, value } from "../factory.js";
import type { ResearchRoomSemanticJudgeRequest } from "@sestina/review";
class TimeoutProvider extends SyntheticProvider { override analyze(request: ResearchRoomSemanticJudgeRequest): Promise<unknown> { this.calls.push(request); return new Promise(() => {}); } }
it.each(["accepted", "modified_accepted", "direction_changed"] as const)("P1-01 G4: actual Provider timeout cannot veto %s", async disposition => {
 const provider = new TimeoutProvider(), s = await syntheticProject(provider, 20);
 try { const p = s.prepare(), r = value(await s.core.analyzeResearchRoomSuggestion({ reviewId: p.reviewId, confirmationNonce: p.confirmationNonce, manifestHash: p.manifestHash })); expect(r.ledgerOnlyReason).toBe("provider_timeout"); expect(provider.calls).toHaveLength(1);
  expect(s.core.commitResearchRoomDisposition({ projectId: s.projectId, reviewId: r.reviewId, authorityNonce: r.authorityNonce, expectedStateBinding: r.stateBinding, disposition, modifiedProposal: "Synthetic bounded edit.", redirectQuestion: "Synthetic new direction?", reason: "User decides despite missing assessment.", actor: USER }).ok).toBe(true);
 } finally { await s.cleanup(); }
});
it("P1-01/P1-05 G5: skipping the pending Provider attempt preserves a resumable user Review", async () => {
 const provider = new SyntheticProvider(), s = await syntheticProject(provider);
 try { const p = s.prepare(); value(s.core.cancelResearchRoomReview({ reviewId: p.reviewId, confirmationNonce: p.confirmationNonce, manifestHash: p.manifestHash })); expect(provider.calls).toHaveLength(0); const db = await openDatabase({ path: s.databasePath, readOnly: true });
  try { const table = db.get<{ name: string }>("SELECT name FROM sqlite_schema WHERE name='research_reviews'"); const saved = table ? db.get("SELECT review_id FROM research_reviews WHERE review_id=?", p.reviewId) : undefined; expect(saved).toBeDefined(); } finally { db.close(); }
 } finally { await s.cleanup(); }
});
