import { beforeAll,afterAll,it,expect } from "vitest";
import { migrateKernelProject,openKernelProject } from "@sestina/core";
import { createResearchStore,createResearchUnitOfWork,readKernelSnapshot,readKernelBriefMetadata,writeKernelBriefMetadata,readKernelProjection } from "@sestina/research-store";
import { parseResearchBrief,type KernelEffectKind } from "@sestina/research";
import { oldCorpus } from "../legacy-fixtures.js";
import { at,capability,ids,prepare } from "../kernel-fixtures.js";
import { USER,value } from "../factory.js";
let corpus:Awaited<ReturnType<typeof oldCorpus>>;beforeAll(async()=>{corpus=await oldCorpus();});afterAll(async()=>{await corpus?.cleanup();});
async function fixture(kind:KernelEffectKind){const p=await corpus.project(20);await migrateKernelProject({projectRoot:p.root});const db=await openKernelProject(p.root),projectId=p.entry.projectId;const uow=createResearchUnitOfWork(db,{authorize:c=>c.authorityCapability===capability}).kernel!;
 const briefObject=readKernelSnapshot(db,projectId).state.objects.find(o=>o.kind==="brief")!;const before=value(createResearchStore(db).briefs.getById(projectId,briefObject.id))!;const last=before.versions.at(-1)!;

 return {p,db,projectId,uow,before,last,async cleanup(){db.close();await p.cleanup();}};
}
// Construct a valid aggregate as fixture data; G4 still owns effect semantics.
function nextBrief(f:Awaited<ReturnType<typeof fixture>>,kind:KernelEffectKind){const versionId=ids.create("rbrf_");return value(parseResearchBrief({...f.before,version:f.before.version+1,currentVersionId:versionId,versions:[...f.before.versions,{...f.last,id:versionId,versionNumber:f.last.versionNumber+1,source:{actor:USER,authority:"user_recorded",recordedAt:at},createdAt:at,supersedes:f.last.id,...(kind==="formal_direction_change"?{projectQuestion:"New synthetic bounded research direction."}:{currentTask:"Synthetic task revision."})}]}));}
it("G3: a Brief cannot commit with metadata still bound to its old active version",async()=>{
 const f=await fixture("patch_brief");try{const next=nextBrief(f,"patch_brief"),p=prepare(f.uow,f.projectId,"patch_brief",[{kind:"brief",id:f.before.id,version:f.before.version}]);expect(f.uow.commitCanonical(p.command,r=>{value(r.briefs.compareAndSwap(next,f.before.version));}).ok).toBe(false);expect(readKernelSnapshot(f.db,f.projectId).head.revision).toBe(1);}finally{await f.cleanup();}
});
it.each(["patch_brief","formal_direction_change"] as const)("G3: %s atomically binds Brief metadata and keeps the old file explicitly derived",async kind=>{
 const f=await fixture(kind);try{const next=nextBrief(f,kind),m=readKernelBriefMetadata(f.db,f.projectId,f.before.id)!;const p=prepare(f.uow,f.projectId,kind,[{kind:"brief",id:f.before.id,version:f.before.version}]);const metadata={...m,version:next.version,metadata:{...m.metadata,currentVersionId:next.currentVersionId,versions:[...m.metadata.versions,{...m.metadata.versions.at(-1)!,versionId:next.currentVersionId}]}};
 value(f.uow.commitCanonical(p.command,r=>{value(r.briefs.compareAndSwap(next,f.before.version));writeKernelBriefMetadata(f.db,metadata,m.version);}));expect(readKernelSnapshot(f.db,f.projectId).head.revision).toBe(2);f.db.close();const reopened=await openKernelProject(f.p.root);try{expect(readKernelSnapshot(reopened,f.projectId).state.objects.find(o=>o.kind==="brief")?.data.currentVersionId).toBe(next.currentVersionId);expect(readKernelProjection(reopened,f.projectId,"brief_file")).toMatchObject({status:"rebuilding",sourceProjectStateRevision:1});}finally{reopened.close();}
 }finally{await f.cleanup();}
});
