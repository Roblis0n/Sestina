import { expect, it } from "vitest";
import { ApplicationProvider, applicationFixture, session } from "../application-fixtures.js";
import { readKernelSnapshot } from "@sestina/research-store";

async function selectedContext(f: Awaited<ReturnType<typeof applicationFixture>>) {
  f.kernel.governMemory("create-context",1,{action:"create",kind:"working_hint",content:{text:"SYNTHETIC_PRIVACY_TRANSACTION"},retention:{policy:"until_unpinned"},sensitivity:"public",outboundPolicy:"explicit_manifest_only",publicReason:"Local context"},session);
  const first=f.kernel.memory(session).items[0]?.item;
  if(!first) throw new Error("fixture memory missing");
  f.kernel.governMemory("use-context",2,{action:"confirm",itemId:first.id,expectedVersion:first.version,publicReason:"Use context"},session);
  const item=f.kernel.memory(session).items[0]?.item;
  if(!item || item.state === "forgotten") throw new Error("fixture memory unavailable");
  const review=f.kernel.createReview("Inspect a bounded change",session);
  const prepared=await f.kernel.prepareManifest(review.id,review.version,{memory:[{id:item.id,version:item.version,contentHash:item.contentHash}]},true,session);
  const confirmed=await f.kernel.confirmManifest(review.id,prepared.review.version,prepared.manifest.identityHash,session);
  const ready=f.kernel.prepareAttempt(review.id,confirmed.version,session);
  return {item,review,prepared,ready,input:{action:"forget",itemId:item.id,expectedVersion:item.version,confirmation:"FORGET",publicReason:"user_requested_irreversible_forget"}};
}

it.each([1,2])("G7: privacy write failure %s restores the whole transaction and immutable triggers",async(stop)=>{
  let armed=false, count=0;
  const provider=new ApplicationProvider();
  const f=await applicationFixture(provider,{faultInjection(point){if(armed&&point==="privacy_copy"&&++count===stop)throw new Error("synthetic privacy write failure");}});
  try{
    const x=await selectedContext(f);
    await f.kernel.startAttempt(x.review.id,x.ready.version,x.prepared.manifest.identityHash,session);
    const before=readKernelSnapshot(f.kernel.database,f.kernel.projectId);
    const beforeReview=f.kernel.readReview(x.review.id,session);
    const triggers=f.kernel.database.all("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name");
    armed=true;
    expect(()=>f.kernel.governMemory("forget-context",3,x.input,session)).toThrow();
    expect(count).toBe(stop);
    expect(readKernelSnapshot(f.kernel.database,f.kernel.projectId)).toEqual(before);
    expect(f.kernel.readReview(x.review.id,session)).toEqual(beforeReview);
    expect(f.kernel.inspectManifest(x.review.id,session)?.exactRequestBody).toContain("SYNTHETIC_PRIVACY_TRANSACTION");
    expect(f.kernel.database.all("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name")).toEqual(triggers);
    expect(f.kernel.lookupCommand("forget-context",session)).toBeUndefined();
    armed=false;
    f.kernel.governMemory("forget-context",3,x.input,session);
    await f.restart();
    expect(f.kernel.inspectManifest(x.review.id,session)?.exactRequestBody).toBeNull();
    expect(f.kernel.memory(session).items[0]?.item.state).toBe("forgotten");
  }finally{await f.cleanup();}
});

it("G7: Forget aborts an in-flight request and a late response cannot restore its body",async()=>{
  let release: ((value:string)=>void)|undefined;
  let started: (()=>void)|undefined;
  const connected=new Promise<void>(resolve=>{started=resolve;});
  let signal:AbortSignal|undefined;
  const provider=new ApplicationProvider();
  provider.send=(body,abort)=>{provider.calls.push(body);signal=abort;started?.();return new Promise<string>(resolve=>{release=resolve;});};
  const f=await applicationFixture(provider,{timeoutMs:5000});
  try{
    const x=await selectedContext(f);
    const running=f.kernel.startAttempt(x.review.id,x.ready.version,x.prepared.manifest.identityHash,session);
    await connected;
    f.kernel.governMemory("forget-context",3,x.input,session);
    expect(signal?.aborted).toBe(true);
    release?.("SYNTHETIC_PRIVACY_TRANSACTION");
    await running;
    const view=f.kernel.readReview(x.review.id,session);
    expect(view.attempts[0]).toMatchObject({status:"uncertain",failureCode:"memory_forgotten",assessment:null});
    expect(JSON.stringify(view)).not.toContain("SYNTHETIC_PRIVACY_TRANSACTION");
    await f.restart();
    expect(f.kernel.inspectManifest(x.review.id,session)?.exactRequestBody).toBeNull();
    expect(provider.calls).toHaveLength(1);
  }finally{await f.cleanup();}
});
