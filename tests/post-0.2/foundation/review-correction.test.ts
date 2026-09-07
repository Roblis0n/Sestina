import { it, expect, vi } from "vitest";
import {
  ApplicationProvider,
  applicationFixture,
  session,
  commit,
} from "../application-fixtures.js";

async function assessed(
  f: Awaited<ReturnType<typeof applicationFixture>>,
  r = f.kernel.createReview("Check a bounded observational claim", session),
) {
  const p = await f.kernel.prepareManifest(r.id, r.version, {}, true, session);
  const c = await f.kernel.confirmManifest(
    r.id,
    p.review.version,
    p.manifest.identityHash,
    session,
  );
  const a = f.kernel.prepareAttempt(r.id, c.version, session);
  await f.kernel.startAttempt(
    r.id,
    a.version,
    p.manifest.identityHash,
    session,
  );
  return f.kernel.readReview(r.id, session);
}

it.each(["failure", "invalid", "timeout"] as const)("G7: second-opinion %s keeps original assessment and allows an explicit user outcome after restart",async(mode)=>{
  const originalProvider=new ApplicationProvider(), second=new ApplicationProvider(mode);
  Object.assign(second.identity,{id:"second",model:"second-model",origin:"http://127.0.0.1:2"});
  const f=await applicationFixture(originalProvider,{secondOpinionProvider:()=>Promise.resolve(second)});
  try {
    const original=await assessed(f), attempt=original.attempts[0];
    if(!attempt?.assessmentHash) throw new Error("original assessment missing");
    const child=f.kernel.appendCorrection(original.review.id,original.review.version,attempt.id,attempt.assessmentHash,"Inspect this assessment again",session);
    const after=await assessed(f,child.review);
    expect(after.review.status).toBe(mode==="failure"?"provider_attempt_uncertain":mode==="invalid"?"assessment_recorded":"provider_attempt_failed");
    if(mode==="invalid") expect(after.attempts.at(-1)?.assessment?.envelope).toMatchObject({response_schema_valid:false,provider_assessment_available:false});
    await f.restart();
    expect(second.calls).toHaveLength(1);
    const continued=await f.kernel.skipAssessment(child.review.id,after.review.version,session);
    const receipt=commit(f,continued,{kind:"create_decision",mode:"create",statement:"Retain the observation boundary",rationale:"Second opinion is unavailable and does not grant authority",scope:{kind:"project"},reopenConditions:[],reason:"User checks the available information"});
    expect(receipt.resultingObjects).toEqual([expect.objectContaining({kind:"decision",version:1})]);
    expect(f.kernel.readReview(original.review.id,session).attempts[0]).toEqual(attempt);
    expect(f.kernel.correctionHistory(original.review.id,session)[0]).toMatchObject({status:"closed"});
  } finally {await f.cleanup();}
});

it("G7: second-opinion configuration drift opens zero connections and cancellation cannot auto-resend",async()=>{
  const originalProvider=new ApplicationProvider(),second=new ApplicationProvider("timeout");
  Object.assign(second.identity,{id:"second",model:"second-model",origin:"http://127.0.0.1:2"});
  const f=await applicationFixture(originalProvider,{secondOpinionProvider:()=>Promise.resolve(second),timeoutMs:5000});
  try {
    const original=await assessed(f), attempt=original.attempts[0];
    if(!attempt?.assessmentHash) throw new Error("original assessment missing");
    const child=f.kernel.appendCorrection(original.review.id,original.review.version,attempt.id,attempt.assessmentHash,"Request independent inspection",session);
    const p=await f.kernel.prepareManifest(child.review.id,child.review.version,{},true,session);
    second.identity.configGeneration++;
    await expect(f.kernel.confirmManifest(child.review.id,p.review.version,p.manifest.identityHash,session)).rejects.toMatchObject({code:"stale_revision",reasons:expect.arrayContaining(["provider_generation_changed"])});
    expect(second.calls).toEqual([]);
    const stale=f.kernel.readReview(child.review.id,session).review;
    const p2=await f.kernel.prepareManifest(child.review.id,stale.version,{},true,session);
    const confirmed=await f.kernel.confirmManifest(child.review.id,p2.review.version,p2.manifest.identityHash,session);
    const prepared=f.kernel.prepareAttempt(child.review.id,confirmed.version,session);
    const running=f.kernel.startAttempt(child.review.id,prepared.version,p2.manifest.identityHash,session);
    await vi.waitFor(()=>expect(second.calls).toHaveLength(1));
    const active=f.kernel.readReview(child.review.id,session).review;
    f.kernel.cancelAttempt(child.review.id,active.version,session);
    await running;
    await f.restart();
    expect(f.kernel.readReview(child.review.id,session).attempts.at(-1)?.status).toBe("uncertain");
    expect(second.calls).toHaveLength(1);
    expect(f.kernel.readReview(original.review.id,session).attempts[0]).toEqual(attempt);
  } finally {await f.cleanup();}
});
it("G7: correcting an assessment refuses the same runtime before any second-opinion connection", async () => {
  const provider = new ApplicationProvider();
  const f = await applicationFixture(provider, { secondOpinionProvider: async () => provider });
  try {
    const original = await assessed(f),
      attempt = original.attempts[0]!;
    const c = f.kernel.appendCorrection(
      original.review.id,
      original.review.version,
      attempt.id,
      attempt.assessmentHash,
      "The original inference is disputed",
      session,
    );
    await expect(
      f.kernel.prepareManifest(
        c.review.id,
        c.review.version,
        {},
        true,
        session,
      ),
    ).rejects.toBeDefined();
    expect(provider.calls).toHaveLength(1);
    const r = await f.kernel.skipAssessment(
      c.review.id,
      c.review.version,
      session,
    );
    const receipt = commit(f, r, {
      kind: "record_only",
      outcome: "assessment_disputed",
      reason: "Keep the research claim unchanged",
    });
    expect(receipt.afterProjectStateRevision).toBe(2);
    expect(
      f.kernel.readReview(original.review.id, session).attempts[0],
    ).toEqual(attempt);
  } finally {
    await f.cleanup();
  }
});

it.each(["withdraw", "qualify", "replace", "request_more_context"] as const)("G7: %s persists an isolated continuation and closes only with the user effect", async action => {
  const first = new ApplicationProvider(), second = new ApplicationProvider();
  Object.assign(second.identity, { id: "second-synthetic", model: "independent-fixture" });
  const f = await applicationFixture(first, { secondOpinionProvider: async () => second });
  try {
    const original = await assessed(f), attempt = original.attempts[0];
    if (!attempt?.assessmentHash) throw new Error("Missing original assessment");
    const correction = f.kernel.appendCorrection(original.review.id, original.review.version, attempt.id, attempt.assessmentHash, "REASON_NOT_FOR_SECOND_PROVIDER_389", session, { requestedCorrection: action });
    expect(f.kernel.correctionHistory(correction.review.id, session)[0]?.status).toBe("draft");
    await f.restart();
    expect(second.calls).toEqual([]);
    const completed = await assessed(f, correction.review);
    expect(second.calls).toHaveLength(1);
    expect(second.calls[0]).not.toContain("REASON_NOT_FOR_SECOND_PROVIDER_389");
    expect(second.calls[0]).not.toContain(attempt.assessment?.publicSummary);
    const request = JSON.parse(second.calls[0] ?? "null") as { messages: {content: string}[] };
    const context = JSON.parse(request.messages[1]?.content ?? "null") as { context: { categories: {kind: string}[] } };
    expect(context.context.categories.map(category => category.kind)).not.toContain("outcome_summaries");
    expect(f.kernel.correctionHistory(correction.review.id, session)[0]).toMatchObject({ status: "assessment_recorded", runtimeDistinct: true, contextIsolated: true, cognitiveIndependence: "unproven", comparison: "opinions_available_for_user_comparison", canonicalAuthority: false });
    const receipt = commit(f, completed.review, { kind: "record_only", outcome: "assessment_disputed", reason: "Do not change the research object" });
    expect(receipt.resultingObjects).toEqual([]);
    expect(f.kernel.correctionHistory(correction.review.id, session)[0]?.status).toBe("closed");
    expect(f.kernel.readReview(original.review.id, session).attempts[0]).toEqual(attempt);
  } finally { await f.cleanup(); }
});
