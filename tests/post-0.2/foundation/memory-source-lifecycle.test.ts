import { expect,it } from "vitest";
import { applicationFixture,ApplicationProvider,session,ready,commit } from "../application-fixtures.js";

it("G7: source versions, expiration and explicit renewal govern recall without promoting Memory",async()=>{
  let now="2026-09-07T00:00:00.000Z";
  const provider=new ApplicationProvider();
  const f=await applicationFixture(provider,{clock:{now:()=>new Date(now)}});
  try {
    const brief=f.kernel.brief(session).brief;
    if(!brief)throw new Error("fixture Brief missing");
    const source=f.kernel.memorySource({kind:"brief",id:brief.id,version:brief.version},session);
    const input={action:"create",kind:"working_hint",content:{text:"Synthetic source-bound context"},source,retention:{policy:"until_date",expiresAt:"2026-09-08T00:00:00.000Z"},sensitivity:"public",outboundPolicy:"explicit_manifest_only",publicReason:"Preserve source context"};
    expect(()=>f.kernel.governMemory("forged-source",1,{...input,source:{kind:"direct_user",actorId:"a-model-claiming-to-be-user"}},session)).toThrow();
    f.kernel.governMemory("memory-create",1,input,session);
    const item=f.kernel.memory(session).items[0]?.item;
    if(!item)throw new Error("memory missing");
    f.kernel.governMemory("memory-use",2,{action:"confirm",itemId:item.id,expectedVersion:item.version,publicReason:"Use this note"},session);
    expect(f.kernel.recallMemory("add_context",[],session)).toHaveLength(1);
    now="2026-09-09T00:00:00.000Z";
    expect(f.kernel.memory(session).items[0]).toMatchObject({userState:"not_in_use",reason:"expired",recallEligible:false});
    const current=f.kernel.memory(session).items[0]?.item;
    if(!current)throw new Error("memory missing");
    f.kernel.governMemory("renew-context",3,{action:"renew",itemId:current.id,expectedVersion:current.version,retention:{policy:"until_unpinned"},publicReason:"Continue this bounded task"},session);
    expect(f.kernel.recallMemory("resume",[],session)).toHaveLength(1);
    const r=await ready(f);
    commit(f,r,{kind:"patch_brief",targetId:brief.id,expectedVersion:brief.version,baseVersionId:brief.currentVersionId,changes:{currentTask:"A changed synthetic task"},reason:"Change this task explicitly"});
    expect(f.kernel.memory(session).items[0]).toMatchObject({userState:"not_in_use",reason:"source_version_changed",sendEligible:false});
    expect(f.kernel.recallMemory("add_context",[],session)).toEqual([]);
    const stale=f.kernel.memory(session).items[0]?.item;
    if(!stale||stale.state==="forgotten")throw new Error("memory missing");
    const draft=f.kernel.createReview("Inspect fresh context",session);
    await expect(f.kernel.prepareManifest(draft.id,draft.version,{memory:[{id:stale.id,version:stale.version,contentHash:stale.contentHash}]},true,session)).rejects.toThrow();
    expect(provider.calls).toEqual([]);
    f.kernel.governMemory("retire-context",5,{action:"retire",itemId:stale.id,expectedVersion:stale.version,publicReason:"Stop using the outdated note"},session);
    await f.restart();
    expect(f.kernel.memory(session).items[0]?.item.state).toBe("retired");
    expect(f.kernel.brief(session).projectStateRevision).toBe(6);
  }finally{await f.cleanup();}
});
