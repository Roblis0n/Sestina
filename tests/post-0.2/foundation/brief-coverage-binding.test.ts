import { expect, it } from "vitest";
import { applicationFixture, ApplicationProvider, session } from "../application-fixtures.js";
import { parseKernelManifest, manifestIdentity } from "@sestina/research";

it("G6: hash-consistent but incomplete or invented Coverage cannot enter a Manifest",async()=>{
  const f=await applicationFixture();
  try {
    const r=f.kernel.createReview("Inspect the current task",session);
    await f.kernel.skipAssessment(r.id,r.version,session);
    const original=f.kernel.inspectManifest(r.id,session)!;
    for(const rows of [[],original.contextSelection.briefCoverage!.map((row,i)=>i===0?{...row,section:"inventedSection"}:row)]) {
      const changed={...original,contextSelection:{...original.contextSelection,briefCoverage:rows}};
      expect(()=>parseKernelManifest({...changed,identityHash:manifestIdentity(changed)})).toThrow();
    }
  }finally{await f.cleanup();}
});

it("G6: task Coverage is the same in the application, durable Manifest and exact sent bytes", async () => {
  const provider = new ApplicationProvider();
  const f = await applicationFixture(provider);
  try {
    const r = f.kernel.createReview("Inspect the proposed evidence boundary", session);
    const expected = f.kernel.coverage(r.id, "add_evidence", [], session);
    const prepared = await f.kernel.prepareManifest(r.id, r.version, {
      evidenceIds: [], issueIds: [], memory: [],
      coverageScope: { effectKind: "add_evidence", targetKinds: [] },
    } as Parameters<typeof f.kernel.prepareManifest>[2], true, session);
    const body = prepared.manifest.exactRequestBody;
    expect(body).not.toBeNull();
    const request = JSON.parse(body as string) as { messages: { content: string }[] };
    const content = JSON.parse(request.messages[1]?.content ?? "null") as { context: { briefCoverage: unknown; categories: { kind: string; items: unknown[] }[] } };
    expect(content.context.briefCoverage).toEqual(expected);
    expect(prepared.manifest.contextSelection).toMatchObject({ briefCoverage: expected });
    expect(prepared.manifest.limitations).not.toContain("Brief allowedChanges: not_provided.");
    await f.restart();
    const confirmed = await f.kernel.confirmManifest(r.id, prepared.review.version, prepared.manifest.identityHash, session);
    const ready = f.kernel.prepareAttempt(r.id, confirmed.version, session);
    await f.kernel.startAttempt(r.id, ready.version, prepared.manifest.identityHash, session);
    expect(provider.calls).toEqual([body]);
  } finally { await f.cleanup(); }
});

it("G6: skipping assessment retains the same scoped Coverage without creating send bytes", async () => {
  const f = await applicationFixture();
  try {
    const r = f.kernel.createReview("Inspect a Brief patch", session);
    const expected = f.kernel.coverage(r.id, "patch_brief", [], session);
    await f.kernel.skipAssessment(r.id, r.version, session, {coverageScope:{effectKind:"patch_brief", targetKinds:[]}});
    await f.restart();
    expect(f.kernel.inspectManifest(r.id, session)).toMatchObject({provider:null, exactRequestBody:null, exactRequestBytes:0, contextSelection:{briefCoverage:expected}});
  } finally { await f.cleanup(); }
});
