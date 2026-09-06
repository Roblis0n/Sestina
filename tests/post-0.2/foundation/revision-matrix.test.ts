import { beforeAll,afterAll,it,expect } from "vitest";
import { migrateKernelProject,openKernelProject,restoreKernelPreMigrationBackup } from "@sestina/core";
import { createResearchStore,createResearchUnitOfWork,readKernelSnapshot } from "@sestina/research-store";
import { FixedClock,confirmProjectWorkingMemory,editProjectWorkingMemory,renewProjectWorkingMemory,retireProjectWorkingMemory,forgetProjectWorkingMemory,expireProjectWorkingMemory,markProjectWorkingMemorySourceStale,kernelHash,type KernelCanonicalCommand,type ProjectWorkingMemory } from "@sestina/research";
import { oldCorpus } from "../legacy-fixtures.js";
import { capability,ids,at,prepare } from "../kernel-fixtures.js";
import { USER,value } from "../factory.js";
let corpus:Awaited<ReturnType<typeof oldCorpus>>;beforeAll(async()=>{corpus=await oldCorpus();});afterAll(async()=>{await corpus?.cleanup();});
const ports={clock:new FixedClock(at),idFactory:ids};
function command(projectId:string,revision:number,item:ProjectWorkingMemory,kind:KernelCanonicalCommand["effectKind"]="memory_governance_change"):KernelCanonicalCommand{return {projectId,authorityCommandId:ids.create("rpev_"),reviewId:null,expectedReviewVersion:null,expectedProjectStateRevision:revision,effectId:ids.create("rpev_"),effectKind:kind,previewHash:kernelHash({id:item.id,revision,kind}),objectVersions:[{kind:"memory",id:item.id,version:item.version}],actor:USER,authorityCapability:capability,publicReason:"Synthetic explicit Memory governance.",receiptId:ids.create("rrcp_"),eventId:ids.create("rpev_"),createdAt:at};}
it.each(["confirm","edit","renew","retire","forget","expire","stale"])("G3: Memory %s advances once and does not create a Review or evidence",async action=>{
 const p=await corpus.project(20);try{await migrateKernelProject({projectRoot:p.root});const db=await openKernelProject(p.root);try{
  const store=createResearchStore(db),uow=createResearchUnitOfWork(db,{authorizeGovernance:c=>c.authorityCapability===capability}).kernel!;
  const all=value(store.workingMemory.listByProject(p.entry.projectId,{limit:100})).items;
  let memory=all.find(m=>m.state===(action==="confirm"?"candidate":action==="renew"||action==="stale"?"stale":action==="expire"?"expired":"active"))!;
  if(action==="stale"||action==="expire"){const renewed=value(renewProjectWorkingMemory(memory,{expectedVersion:memory.version,retention:{policy:"until_date",expiresAt:"2026-09-07T00:00:00.000Z"},actor:USER,publicReason:"Synthetic renew before lifecycle transition."},ports));value(uow.commitCanonical(command(p.entry.projectId,1,memory),repos=>{value(repos.workingMemory.compareAndSwap(renewed,memory.version));}));memory=renewed;}
  const revision=readKernelSnapshot(db,p.entry.projectId).head.revision;
  const input={expectedVersion:memory.version,actor:USER,publicReason:"Synthetic governance input."};
  const next=action==="confirm"?value(confirmProjectWorkingMemory(memory,input,ports)):action==="edit"?value(editProjectWorkingMemory(memory,{...input,content:{text:"Synthetic edited context; not evidence."},retention:{policy:"until_unpinned"},sensitivity:"project_private",outboundPolicy:"never_send"},ports)):action==="renew"?value(renewProjectWorkingMemory(memory,{...input,retention:{policy:"until_unpinned"}},ports)):action==="retire"?value(retireProjectWorkingMemory(memory,input,ports)):action==="forget"?value(forgetProjectWorkingMemory(memory,{...input,confirmation:"FORGET",publicReason:"user_requested_irreversible_forget"},ports)):action==="expire"?value(expireProjectWorkingMemory(memory,{currentEpisodeActive:false,publicReason:"Synthetic expiration."},{...ports,clock:new FixedClock("2026-09-08T00:00:00.000Z")})):value(markProjectWorkingMemorySourceStale(memory,{sourceAvailable:true,objectVersion:2,contentFingerprint:"2".repeat(64),publicReason:"Synthetic source version changed."},ports));
  const cmd=command(p.entry.projectId,revision,memory,action==="forget"?"privacy_redaction":"memory_governance_change");let persisted:unknown;const committed=uow.commitCanonical(cmd,repos=>{persisted=repos.workingMemory.compareAndSwap(next,memory.version);});expect(persisted).toMatchObject({ok:true});const receipt=value(committed);
  expect(receipt.reviewId).toBeNull();expect(readKernelSnapshot(db,p.entry.projectId).head.revision).toBe(revision+1);expect(value(uow.lookupCommand(p.entry.projectId,cmd.authorityCommandId))).toEqual(receipt);expect(db.all("SELECT * FROM research_reviews")).toHaveLength(5);expect(db.all("SELECT * FROM argument_evidence")).toHaveLength(0);
  expect(db.get<{last_confirmed_revision:number|null}>("SELECT last_confirmed_revision FROM research_memory_metadata WHERE item_id=?",memory.id)?.last_confirmed_revision).toBe(next.state==="active"?revision+1:null);
  if(action==="forget"){expect(db.get("SELECT redaction_id FROM research_privacy_redactions WHERE object_id=? AND source_revision=?",memory.id,revision+1)).toBeDefined();db.close();await expect(restoreKernelPreMigrationBackup(p.root)).rejects.toMatchObject({code:"recovery_required"});const reopened=await openKernelProject(p.root);try{expect(readKernelSnapshot(reopened,p.entry.projectId).head.revision).toBe(revision+1);expect(value(createResearchStore(reopened).workingMemory.getById(p.entry.projectId,memory.id))?.state).toBe("forgotten");}finally{reopened.close();}}
 }finally{db.close();}}finally{await p.cleanup();}
});
it("G3: a Review approval is not a Memory governance capability",async()=>{
 const p=await corpus.project(20);try{await migrateKernelProject({projectRoot:p.root});const db=await openKernelProject(p.root);try{const uow=createResearchUnitOfWork(db,{authorize:()=>true}).kernel!;const memory=value(createResearchStore(db).workingMemory.listByProject(p.entry.projectId,{limit:100})).items[0]!;
  expect(uow.commitCanonical(command(p.entry.projectId,1,memory),()=>{})).toMatchObject({ok:false,error:{code:"authority_required"}});
  const review=prepare(uow,p.entry.projectId);expect(uow.commitCanonical({...review.command,effectKind:"memory_governance_change"},()=>{})).toMatchObject({ok:false,error:{code:"invalid_record"}});
 }finally{db.close();}}finally{await p.cleanup();}
});
