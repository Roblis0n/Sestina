import { beforeAll,afterAll,it,expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { migrateKernelProject,openKernelProject } from "@sestina/core";
import { createResearchUnitOfWork } from "@sestina/research-store";
import { oldCorpus } from "../legacy-fixtures.js";
import { draft,ids } from "../kernel-fixtures.js";
import { value } from "../factory.js";
let corpus:Awaited<ReturnType<typeof oldCorpus>>;beforeAll(async()=>{corpus=await oldCorpus();});afterAll(async()=>{await corpus?.cleanup();});
it.each(["column_version","orphan_attempt_binding"])("G3: startup rejects %s even when the canonical head has not changed",async mode=>{
 const p=await corpus.project(20);try{
  await migrateKernelProject({projectRoot:p.root});const db=await openKernelProject(p.root);const uow=createResearchUnitOfWork(db).kernel!;
  const review=value(uow.workflow(r=>r.reviews.create(draft(p.entry.projectId,1))));db.close();
  const raw=new DatabaseSync(join(p.root,".sestina/state.sqlite"));try{
   if(mode==="column_version")raw.prepare("UPDATE research_reviews SET version=99 WHERE review_id=?").run(review.id);
   else raw.prepare("UPDATE research_reviews SET data=? WHERE review_id=?").run(JSON.stringify({...review,attemptIds:[ids.create("rpat_")]}),review.id);
  }finally{raw.close();}
  const accepted=await openKernelProject(p.root).then(opened=>{opened.close();return true;},()=>false);expect(accepted).toBe(false);
 }finally{await p.cleanup();}
});
