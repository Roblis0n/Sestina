import { afterAll as finishLegacyObservation } from "vitest";
import * as oldResearch from "@sestina/research";
import { openDatabase as openOldDatabase } from "@sestina/storage";
import { createResearchStore as createOldStore } from "@sestina/research-store";
import { mkdir as createDirectory, readFile as readBytes, writeFile as writeBytes } from "node:fs/promises";
import { join as joinPath } from "node:path";
import { createHash as createDigest } from "node:crypto";

// This file is concatenated with the pinned test source by the materializer.
// Its variables are scoped to that synthetic test process, never an application.
const capturedLegacyStates=new Map<string,unknown>();
Date.now=()=>Date.parse("2026-08-30T00:00:00.000Z");
function observeLegacyReturn<T>(returned:T):T {
 const candidate=returned&&typeof returned==="object"&&"ok" in returned&&returned.ok===true&&"value" in returned?returned.value:returned;
 const parser=fixtureKind==="correction-appeal"?oldResearch.parseCorrectionAppeal:fixtureKind==="deliberation-room"?oldResearch.parseDeliberationRoom:oldResearch.parseClosedExternalAppPilot;
 const parsed=parser(candidate);if(parsed.ok){const item=parsed.value;const stages="attempts"in item?item.attempts.map(a=>a.status).join("-"):item.initialRound?.attempts.map(a=>a.status).join("-")??"none";const key=`${fixtureKind}-${item.status}-${stages||"none"}`;if(!capturedLegacyStates.has(key))capturedLegacyStates.set(key,item);}
 return returned;
}
finishLegacyObservation(async()=>{
 if(fixtureKind==="correction-appeal"){
  const running=[...capturedLegacyStates.values()].find((v:any)=>v.status==="second_opinion_running") as oldResearch.CorrectionAppeal;
  const last=running.attempts.at(-1)!;const base=secondResult(running.id,last.id);const binding=running.source.inputBindings[0]!;
  const result={...base,evidenceSpans:base.evidenceSpans.map(span=>({...span,projectId:running.projectId,artifactId:binding.artifactId,revisionId:binding.revisionId,normalizedTextHash:binding.normalizedTextHash}))};
  const comparison=oldResearch.deriveAppealComparison({originalAssessment:"present",originalEvidenceHashes:[],secondOpinion:result});
  const clock=new oldResearch.FixedClock("2026-08-30T00:00:00.000Z");
  const ready=observeLegacyReturn(oldResearch.completeCorrectionAppealSecondOpinion(running,{expectedVersion:running.version,attemptId:last.id,result,comparison},clock));if(!ready.ok)throw Error(ready.error.code);
  observeLegacyReturn(oldResearch.markCorrectionAppealStale(running,{expectedVersion:running.version,reason:"Synthetic revision conflict"},clock));
  observeLegacyReturn(oldResearch.failCorrectionAppealSecondOpinion(running,{expectedVersion:running.version,attemptId:last.id,failure:"result_write_uncertain"},clock));
  // The old schema declares this state but has no exported transition helper.
  // Exercise its exact old decoder + repository using a synthetic legal history.
  const waiting=observeLegacyReturn(oldResearch.parseCorrectionAppeal({...ready.value,status:"waiting_user_resolution",version:ready.value.version+1,updatedAt:clock.now().toISOString(),transitions:[...ready.value.transitions,{from:"second_opinion_ready",to:"waiting_user_resolution",actor:"kernel",at:clock.now().toISOString(),reason:"synthetic_waiting_user"}]}));if(!waiting.ok)throw Error(waiting.error.code);
 }
 const hashes=[];
 for(const [key,candidate]of [...capturedLegacyStates].sort(([a],[b])=>a<b?-1:a>b?1:0)){
  const item=candidate as {id:string;projectId:string;status:string};
  const directory=joinPath(fixtureOutput,"states",key,".sestina");await createDirectory(directory,{recursive:true});const path=joinPath(directory,"state.sqlite");
  const db=await openOldDatabase({path});try{
   const clock=new oldResearch.FixedClock("2026-08-30T00:00:00.000Z"), ids=new oldResearch.SequenceIdFactory(500000);
   const project=oldResearch.createResearchProject({title:"Synthetic old workflow state",rootPath:".",source:{actor:{kind:"user",actorId:"synthetic-owner"},authority:"user_recorded",recordedAt:clock.now().toISOString()}},{clock,idFactory:{create(prefix){return prefix==="rprj_"?item.projectId:ids.create(prefix);}}});if(!project.ok)throw Error(project.error.code);
   const store=createOldStore(db);const stored=store.projects.create(project.value);if(!stored.ok)throw Error(stored.error.code);
   const result=fixtureKind==="correction-appeal"?store.correctionAppeals.create(candidate as oldResearch.CorrectionAppeal):fixtureKind==="deliberation-room"?store.deliberationRooms.create(candidate as oldResearch.DeliberationRoom):store.closedExternalAppPilots.create(candidate as oldResearch.ClosedExternalAppPilot);
   if(!result.ok)throw Error(result.error.code);db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }finally{db.close();}
  hashes.push({key,schema:20,projectId:item.projectId,objectId:item.id,status:item.status,databaseSha256:createDigest("sha256").update(await readBytes(path)).digest("hex"),expected:{authority:"history_only",sourcePreserved:true,baselineEvents:1,newDecisionOrEvidence:0,classification:fixtureKind==="correction-appeal"?"orphan":"legacy_status_preserved"}});
 }
 await writeBytes(joinPath(fixtureOutput,`${fixtureKind}-states.json`),JSON.stringify(hashes,null,2)+"\n");
});
