import { it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { SyntheticProvider, syntheticProject, USER, value } from "../factory.js";
import type { ResearchRoomSemanticJudgeRequest } from "@sestina/review";

class ChallengedProvider extends SyntheticProvider {
  override async analyze(request: ResearchRoomSemanticJudgeRequest): Promise<unknown> {
    const response = await super.analyze(request) as { assessments: { criterionId: string; verdict: string }[] };
    return { ...response, assessments: response.assessments.map(a => ({ ...a, verdict: a.criterionId === "argument-leap" ? "positive" : a.verdict })) };
  }
}
it("P2-01 G9: resolving an interpretation challenge must lead to the unified Review effect path", async () => {
 const s = await syntheticProject(new ChallengedProvider());
 try {
  const p = s.prepare(), analyzed = value(await s.core.analyzeResearchRoomSuggestion({ reviewId: p.reviewId, confirmationNonce: p.confirmationNonce, manifestHash: p.manifestHash }));
  const receipt = value(s.core.commitResearchRoomDisposition({ projectId: s.projectId, reviewId: analyzed.reviewId, authorityNonce: analyzed.authorityNonce, expectedStateBinding: analyzed.stateBinding, disposition: "deferred", reason: "Synthetic challenge source.", actor: USER }));
  const finding = receipt.semanticJudge?.findings.find(f => f.kind === "argument_leap"); expect(finding).toBeDefined();
  let appeal = value(s.core.createCorrectionAppeal({ projectId: s.projectId, receiptId: receipt.id, findingId: finding!.id, actor: USER, statement: { disagreement: "Synthetic disagreement.", challengedCriterionId: "argument-leap", claimedError: "Unsupported inference.", missingOrMisreadContext: "The sentence is conditional.", secondOpinionQuestion: "What supports the claim?", desiredDisposition: "modify_finding_interpretation" } }));
  appeal = value(s.core.recordCorrectionAppeal({ projectId: s.projectId, appealId: appeal.id, expectedVersion: appeal.version, actor: USER }));
  appeal = value(s.core.markCorrectionAppealRecordOnly({ projectId: s.projectId, appealId: appeal.id, expectedVersion: appeal.version, actor: USER }));
  const result = value(s.core.resolveCorrectionAppeal({ projectId: s.projectId, appealId: appeal.id, expectedVersion: appeal.version, actor: USER, kind: "modify_finding_interpretation", publicReason: "Synthetic interpretation correction." }));
  expect(result.source.findingSnapshot).toEqual(appeal.source.findingSnapshot);
  expect({ status: result.status, canonicalReviewId: (result as unknown as { canonicalReviewId?: string }).canonicalReviewId ?? null }).toMatchObject({ canonicalReviewId: expect.any(String) });
 } finally { await s.cleanup(); }
});
it("P2-02 G12: production package declares a bundled Electron application entry", async () => {
 const pkg = JSON.parse(await readFile("apps/research-room/package.json", "utf8"));
 // This is the real package contract consumed by the release builder. The
 // passing v0.2 artifact identity/lifecycle suite remains a separate gate.
 expect({ main: pkg.main ?? null, electron: pkg.dependencies?.electron ?? pkg.devDependencies?.electron ?? null }).toMatchObject({ main: expect.any(String), electron: expect.any(String) });
});
