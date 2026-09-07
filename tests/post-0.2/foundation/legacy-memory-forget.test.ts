import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { syntheticProject, USER, value } from "../factory.js";
import { session, resolveUser } from "../application-fixtures.js";
import { migrateKernelProject, openResearchDeliberationKernel, createProjectStateBackup, previewProjectStateRestore } from "@sestina/core";

it("G7: a legacy Pilot retains its history, then Forget removes its linked bodies and verified old copies", async () => {
  const s = await syntheticProject();
  let k: Awaited<ReturnType<typeof openResearchDeliberationKernel>> | undefined;
  try {
    const note = value(s.core.createProjectMemoryCandidate({ projectId:s.projectId, kind:"working_hint",content:{text:"SYNTHETIC_LEGACY_FORGET_420"},retention:{policy:"until_unpinned"},sensitivity:"public",outboundPolicy:"explicit_manifest_only",publicReason:"Synthetic legacy context",actor:USER }));
    const active = value(s.core.confirmProjectMemory({projectId:s.projectId,itemId:note.id,expectedVersion:note.version,publicReason:"Use synthetic note",actor:USER}));
    let pilot = value(s.core.createClosedExternalAppPilot({projectId:s.projectId,evidenceClass:"synthetic_fixture",actor:USER}));
    pilot = value(s.core.recordClosedExternalAppPilotPreflight({projectId:s.projectId,pilotId:pilot.id,expectedVersion:pilot.version,availability:"available",supportedVersion:"codex-cli 0.150.0",verifiedAt:new Date().toISOString(),capabilities:{start:"observed",structuredOutput:"unproven",mcp:"unproven",readOnlySandbox:"unproven",cancellation:"unproven",contextIsolation:"unproven"}}));
    pilot = value(s.core.prepareClosedExternalAppPilotContext({projectId:s.projectId,pilotId:pilot.id,expectedVersion:pilot.version,kind:"candidate_generation",selectedMemoryItemIds:[active.id],confirmationExpiresAt:new Date(Date.now()+600000).toISOString(),externalModelServiceMayBeCalled:true,timeoutMs:120000,outputLimitBytes:65536,actor:USER}));
    const oldBackup = value(await createProjectStateBackup({projectRoot:s.root}));
    s.core.close(); await migrateKernelProject({projectRoot:s.root});
    k = await openResearchDeliberationKernel(s.root,{resolveUser});
    expect((await previewProjectStateRestore({projectRoot:s.root, backupId:oldBackup.backupId})).ok).toBe(false);
    const history = k.legacyHistory("closed_external_app_pilots",{limit:20},session);
    expect(JSON.stringify(history)).toContain("SYNTHETIC_LEGACY_FORGET_420");
    const childBefore = k.database.all<{data:string}>("SELECT data FROM closed_external_app_pilot_attempts WHERE project_id=?",s.projectId);
    expect(childBefore).toHaveLength(1);
    k.governMemory("legacy-forget-420",1,{action:"forget",itemId:active.id,expectedVersion:active.version,publicReason:"user_requested_irreversible_forget",confirmation:"FORGET"},session);
    expect(JSON.stringify(k.legacyHistory("closed_external_app_pilots",{limit:20},session))).not.toContain("SYNTHETIC_LEGACY_FORGET_420");
    expect(k.database.all<{data:string}>("SELECT data FROM closed_external_app_pilot_attempts WHERE project_id=?",s.projectId).every(row=>(JSON.parse(row.data) as {bodyAvailable?:boolean}).bodyAvailable===false)).toBe(true);
    const preview = await k.privacyCopyPreview(session);
    const oldDatabase = preview.files.find(file=>file.locationToken.endsWith("backup/state.sqlite"));
    expect(oldDatabase).toBeDefined();
    expect((await readFile(join(s.state, oldDatabase?.locationToken ?? "missing"))).includes(Buffer.from("SYNTHETIC_LEGACY_FORGET_420"))).toBe(true);
    await k.cleanupPrivacy(preview.planHash,false,session);
    k.close(); k=await openResearchDeliberationKernel(s.root,{resolveUser});
    expect(k.memory(session).items.find(row=>row.item.id===active.id)?.item.state).toBe("forgotten");
    expect((await k.privacyCopyPreview(session)).blocked).toEqual([]);
    expect(()=>k?.database.run("UPDATE closed_external_app_pilot_events SET data='{}'")).toThrow();
  } finally { k?.close(); await s.cleanup(); }
});
