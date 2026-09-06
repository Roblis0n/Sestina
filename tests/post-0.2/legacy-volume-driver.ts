import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { openDatabase } from "@sestina/storage";
import { createResearchStore } from "@sestina/research-store";
import { SestinaCore } from "@sestina/core";
import { createResearchBrief, createResearchDecision, FixedClock, SequenceIdFactory } from "@sestina/research";
import { makeScenario, USER_SOURCE } from "legacy-scenario";
const output=process.argv[2]!,epoch="2026-08-30T00:00:00.000Z";Date.now=()=>Date.parse(epoch);
const value=<T>(r:{ok:true;value:T}|{ok:false;error:{code:string}}):T=>{if(!r.ok)throw Error(r.error.code);return r.value;};
const sha=(v:Uint8Array|string)=>createHash("sha256").update(v).digest("hex"),fixtures=[];
for(const kind of ["empty","long_brief","large_project"]){
 const directory=join(output,"volume",kind,".sestina");await mkdir(directory,{recursive:true});const path=join(directory,"state.sqlite"),db=await openDatabase({path});
 const s=makeScenario(710000),store=createResearchStore(db),clock=new FixedClock(epoch),ids=new SequenceIdFactory(800000),ports={clock,idFactory:ids};
 value(store.projects.create(s.project));
 if(kind!=="empty"){
  value(store.artifacts.create(s.emptyArtifact));value(store.revisions.append(s.revision1));
  const last=s.brief.versions[0]!;
  const brief=value(createResearchBrief({projectId:s.project.id,projectQuestion:kind==="long_brief"?"Synthetic bilingual research question 合成研究问题。".repeat(1200):last.projectQuestion,currentTask:last.currentTask,currentStage:last.currentStage,targetArtifacts:last.targetArtifacts,fixedDecisions:last.fixedDecisions,allowedChanges:last.allowedChanges,forbiddenChanges:last.forbiddenChanges,expectedDeltas:last.expectedDeltas,evidenceBoundaries:last.evidenceBoundaries,explicitNonGoals:kind==="long_brief"?Array.from({length:100},(_,i)=>`Synthetic non-goal ${i} 不应推断因果。`):last.explicitNonGoals,source:USER_SOURCE},ports));
  value(store.briefs.create(brief));
  if(kind==="large_project")for(let i=0;i<1000;i++)value(store.decisions.create(value(createResearchDecision({projectId:s.project.id,statement:`Synthetic historical decision ${i}`,scope:{kind:"artifact",artifactId:s.emptyArtifact.id},rationale:"Synthetic preservation and pagination fixture.",effectiveBriefVersionId:brief.currentVersionId,reopenConditions:["Explicit new user evidence."],source:USER_SOURCE},ports))));
  const core=new SestinaCore(db,clock,ids),projection=value(core.getActiveBriefProjection(s.project.id));if(!projection)throw Error("missing old Brief");await writeFile(join(directory,"research-brief.yaml"),projection.yaml);
 }
 db.exec("PRAGMA wal_checkpoint(TRUNCATE)");db.close();
 fixtures.push({kind,schema:20,projectId:s.project.id,databaseSha256:sha(await readFile(path)),briefSha256:kind==="empty"?null:sha(await readFile(join(directory,"research-brief.yaml"))),expected:{decisionCount:kind==="large_project"?1000:0,briefCount:kind==="empty"?0:1,baselineEvents:1}});
}
await writeFile(join(output,"volume-hashes.json"),JSON.stringify(fixtures,null,2)+"\n");
