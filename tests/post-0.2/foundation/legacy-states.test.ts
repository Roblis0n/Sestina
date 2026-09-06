import { beforeAll,afterAll,it,expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir,mkdtemp,cp,rm,readFile } from "node:fs/promises";
import { join,resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { migrateKernelProject,openKernelProject } from "@sestina/core";
import { readKernelLegacyRecord,readKernelSnapshot,createResearchStore } from "@sestina/research-store";
import states from "../legacy-states-provenance.json" with {type:"json"};
let root:string;
beforeAll(async()=>{await mkdir(resolve(".tmp"),{recursive:true});root=await mkdtemp(resolve(".tmp/old-workflow-states-"));execFileSync(process.execPath,[resolve("scripts/materialize-post-0.2-states.mjs"),root],{windowsHide:true,stdio:"pipe",maxBuffer:2097152});},120000);
afterAll(async()=>{if(root)await rm(root,{recursive:true,force:true});});
it.each(states.fixtures)("G1/G2: $key is reproducible, migrates without new authority, and stays read-only",async entry=>{
 const source=join(root,"states",entry.key,".sestina");expect(createHash("sha256").update(await readFile(join(source,"state.sqlite"))).digest("hex")).toBe(entry.databaseSha256);
 const project=await mkdtemp(join(tmpdir(),"sestina-history-copy-"));try{
  await cp(source,join(project,".sestina"),{recursive:true});await migrateKernelProject({projectRoot:project});const db=await openKernelProject(project);try{
   const kind=entry.key.startsWith("correction")?"correction_appeals":entry.key.startsWith("deliberation")?"deliberation_rooms":"closed_external_app_pilots";
   const old=readKernelLegacyRecord(db,entry.projectId,kind,entry.objectId)!;expect(old.legacyPayload).toMatchObject({id:entry.objectId,status:entry.status});expect(old.canonicalAuthority).toBe(false);
   const snapshot=readKernelSnapshot(db,entry.projectId);expect(snapshot.head.revision).toBe(1);expect(snapshot.state.objects.map(o=>o.kind)).toEqual(["project"]);expect(db.all("SELECT * FROM research_project_state_events")).toHaveLength(1);
   expect(()=>db.run(`DELETE FROM ${kind}`)).toThrow();const store=createResearchStore(db);const write=kind==="correction_appeals"?store.correctionAppeals.create(old.legacyPayload as never):kind==="deliberation_rooms"?store.deliberationRooms.create(old.legacyPayload as never):store.closedExternalAppPilots.create(old.legacyPayload as never);expect(write.ok).toBe(false);
   if(kind==="correction_appeals")expect(old.classification).toBe("orphan");
  }finally{db.close();}
 }finally{await rm(project,{recursive:true,force:true});}
});
