import { afterAll, beforeAll, expect, it } from "vitest";
import { migrateKernelProject, openKernelProject } from "@sestina/core";
import { createResearchUnitOfWork, readKernelSnapshot, readKernelProjection, rebuildKernelProjection, recoverKernelWorkflows } from "@sestina/research-store";
import { kernelHash, kernelBytesHash, manifestIdentity, type KernelAttempt, type KernelAssessment } from "@sestina/research";
import { oldCorpus } from "../legacy-fixtures.js";
import { at, capability, draft, ids, prepare } from "../kernel-fixtures.js";
import { value } from "../factory.js";

let corpus: Awaited<ReturnType<typeof oldCorpus>>;
beforeAll(async () => { corpus = await oldCorpus(); }); afterAll(async () => { await corpus?.cleanup(); });
async function fixture() {
  const p = await corpus.project(20); await migrateKernelProject({ projectRoot: p.root }); const db = await openKernelProject(p.root);
  const uow = createResearchUnitOfWork(db, { authorize: (c) => c.authorityCapability === capability }).kernel!;
  return { ...p, db, uow, projectId: p.entry.projectId, async cleanup() { db.close(); await p.cleanup(); } };
}
function attempt(reviewId: string, manifestId: string, manifestIdentityHash: string, projectId: string): KernelAttempt {
  return { schemaVersion: "2.0.0", id: ids.create("rpat_"), projectId, reviewId, ordinal: 1, manifestId, manifestIdentityHash, status: "prepared", assessment: null, assessmentHash: null, failureCode: null, version: 1, createdAt: at, updatedAt: at };
}
it("G3: durable exact request bytes preserve decomposed Unicode instead of silently normalizing the payload", async()=>{
 const f=await fixture();try{
  const p=prepare(f.uow,f.projectId,"record_only",[],true);const body='{"text":"e\u0301"}';
  const input={...p.manifest,id:ids.create("rman_"),status:"prepared" as const,version:1,exactRequestBody:body,exactRequestBytes:Buffer.byteLength(body),exactRequestHash:kernelBytesHash(body)};
  const manifest=value(f.uow.workflow(repos=>repos.manifests.create({...input,identityHash:manifestIdentity(input)})));
  expect(f.uow.repositories.manifests.getById(f.projectId,manifest.id)?.exactRequestBody).toBe(body);
 }finally{await f.cleanup();}
});
it("G3: Review, Manifest, attempts and immutable assessment/corrections persist without a canonical revision", async () => {
  const f = await fixture(); try {
    const p = prepare(f.uow, f.projectId, "record_only", [], true);
    let r = p.review; let a = attempt(r.id, p.manifest.id, p.manifest.identityHash, f.projectId);
    value(f.uow.workflow((repos) => { a = repos.attempts.create(a); r = repos.reviews.compareAndSwap({ ...r, status: "provider_attempt_prepared", attemptIds: [a.id], version: r.version + 1 }, r.version); }));
    value(f.uow.workflow((repos) => { a = repos.attempts.compareAndSwap({ ...a, status: "running", version: 2 }, 1); r = repos.reviews.compareAndSwap({ ...r, status: "provider_attempt_running", version: r.version + 1 }, r.version); }));
    const assessment: KernelAssessment = { availability: "received", requestBound: true, schemaValidated: true, quotesLocated: true, claimFieldsParsed: true, semanticCorrectness: "unproven", publicSummary: "Synthetic Provider assessment; this does not prove semantic truth." };
    value(f.uow.workflow((repos) => { a = repos.attempts.compareAndSwap({ ...a, status: "completed", version: 3, assessment, assessmentHash: kernelHash(assessment) }, 2); r = repos.reviews.compareAndSwap({ ...r, status: "assessment_recorded", version: r.version + 1 }, r.version); }));
    const correction = value(f.uow.workflow((repos) => repos.corrections.create({ schemaVersion: "2.0.0", id: ids.create("rapc_"), projectId: f.projectId, reviewId: r.id, attemptId: a.id, originalAssessmentHash: kernelHash(assessment), publicReason: "Synthetic user challenges this rationale.", version: 1, createdAt: at })));
    expect(readKernelSnapshot(f.db, f.projectId).head.revision).toBe(1);
    expect(f.uow.workflow((repos) => repos.attempts.compareAndSwap({ ...a, assessment: { ...assessment, publicSummary: "Overwritten" }, assessmentHash: kernelHash({ ...assessment, publicSummary: "Overwritten" }), version: 4 }, 3))).toMatchObject({ ok: false, error: { code: "illegal_transition" } });
    f.db.close(); const reopened = await openKernelProject(f.root); try {
      const repos = createResearchUnitOfWork(reopened).kernel!.repositories;
      expect(repos.attempts.getById(f.projectId, a.id)).toEqual(a); expect(repos.reviews.getById(f.projectId, r.id)).toEqual(r); expect(repos.corrections.getById(f.projectId, correction.id)).toEqual(correction);
    } finally { reopened.close(); }
  } finally { await f.cleanup(); }
});
it("G3: interrupted running attempts recover as uncertain once, with no resend or revision change", async () => {
  const f = await fixture(); try {
    const p = prepare(f.uow, f.projectId, "record_only", [], true); let r = p.review; let a = attempt(r.id, p.manifest.id, p.manifest.identityHash, f.projectId);
    value(f.uow.workflow((repos) => {
      a = repos.attempts.create(a); r = repos.reviews.compareAndSwap({ ...r, status: "provider_attempt_prepared", attemptIds: [a.id], version: r.version + 1 }, r.version);
      a = repos.attempts.compareAndSwap({ ...a, status: "running", version: 2 }, 1); r = repos.reviews.compareAndSwap({ ...r, status: "provider_attempt_running", version: r.version + 1 }, r.version);
    }));
    f.db.close(); const reopened = await openKernelProject(f.root); try {
      expect(value(recoverKernelWorkflows(reopened, f.projectId, at))).toEqual([r.id]); expect(value(recoverKernelWorkflows(reopened, f.projectId, at))).toEqual([]);
      const uow = createResearchUnitOfWork(reopened).kernel!; const uncertain = uow.repositories.attempts.getById(f.projectId, a.id)!;
      expect(uncertain.status).toBe("uncertain"); expect(uow.repositories.reviews.getById(f.projectId, r.id)?.status).toBe("provider_attempt_uncertain");
      expect(uow.workflow((repos) => repos.attempts.compareAndSwap({ ...uncertain, status: "running", version: uncertain.version + 1 }, uncertain.version))).toMatchObject({ ok: false, error: { code: "illegal_transition" } });
      expect(readKernelSnapshot(reopened, f.projectId).head.revision).toBe(1);
    } finally { reopened.close(); }
  } finally { await f.cleanup(); }
});
it("G3: project-bound keyset pagination, optimistic versions, future data and terminal guards fail closed", async () => {
  const f = await fixture(); try {
    const reviews = Array.from({ length: 3 }, () => draft(f.projectId, 1)); value(f.uow.workflow((repos) => { reviews.forEach((r) => repos.reviews.create(r)); }));
    const repo = f.uow.repositories.reviews; const page = repo.listByProject(f.projectId, { limit: 2 }); expect(page.items).toHaveLength(2); expect(page.nextCursor).toBeDefined();
    const all = [...page.items]; let cursor = page.nextCursor; while (cursor) { const next = repo.listByProject(f.projectId, { limit: 2, cursor }); all.push(...next.items); cursor = next.nextCursor; }
    expect(new Set(all.map((r) => r.id)).size).toBe(8);
    const other = ids.create("rprj_"); expect(repo.getById(other, reviews[0]!.id)).toBeUndefined(); expect(() => repo.listByProject(other, { limit: 2, cursor: page.nextCursor })).toThrow();
    expect(() => repo.listByProject(f.projectId, { limit: 0 })).toThrow(); expect(() => repo.listByProject(f.projectId, { limit: 201 })).toThrow();
    expect(f.uow.workflow((repos) => repos.reviews.create({ ...draft(f.projectId, 1), schemaVersion: "9.0.0" } as never))).toMatchObject({ ok: false, error: { code: "future_schema" } });
    const first = reviews[0]!; const cancelled = value(f.uow.workflow((repos) => repos.reviews.compareAndSwap({ ...first, status: "cancelled", version: 2 }, 1)));
    expect(f.uow.workflow((repos) => repos.reviews.compareAndSwap({ ...cancelled, status: "draft", version: 3 }, 2))).toMatchObject({ ok: false, error: { code: "illegal_transition" } });
  } finally { await f.cleanup(); }
});
it("G3: a failed/stale projection rebuild cannot change canonical state or impersonate a current view", async () => {
  const f = await fixture(); try {
    const before = readKernelSnapshot(f.db, f.projectId); expect(readKernelProjection(f.db, f.projectId, "search").status).toBe("rebuilding");
    expect(rebuildKernelProjection(f.db, f.projectId, "search", () => { throw new Error("synthetic index failure"); }).ok).toBe(false); expect(readKernelSnapshot(f.db, f.projectId)).toEqual(before);
    expect(value(rebuildKernelProjection(f.db, f.projectId, "search", (s) => ({ sourceRevision: s.head.revision })))).toBe(1); expect(readKernelProjection(f.db, f.projectId, "search").status).toBe("ready");
    const p = prepare(f.uow, f.projectId); value(f.uow.commitCanonical(p.command, () => {})); expect(readKernelProjection(f.db, f.projectId, "search")).toMatchObject({ status: "rebuilding", data: null });
    expect(f.db.all("SELECT * FROM research_projection_outbox")).toHaveLength(2);
  } finally { await f.cleanup(); }
});
