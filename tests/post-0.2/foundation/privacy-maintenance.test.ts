import { it, expect } from "vitest";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { applicationFixture, session } from "../application-fixtures.js";
import {
  RandomIdFactory,
  restoreKernelPreMigrationBackup,
} from "@sestina/core";
import { cleanupKernelPrivacyCopies } from "../../../packages/core/src/kernel-privacy-maintenance.js";
import { KernelApplicationApi } from "../../../apps/research-room/src/kernel-api.js";
const ids = new RandomIdFactory();
it("G7: explicit backup retirement retains bytes, records the risk and permanently blocks old restore",async()=>{
  const f=await applicationFixture();
  const api=new KernelApplicationApi({});
  try {
    f.kernel.governMemory("retire-create",1,{action:"create",kind:"working_hint",content:{text:"Synthetic context"},retention:{policy:"until_unpinned"},sensitivity:"public",outboundPolicy:"explicit_manifest_only",publicReason:"Test context"},session);
    const item=f.kernel.memory(session).items[0]!.item;
    f.kernel.governMemory("retire-forget",2,{action:"forget",itemId:item.id,expectedVersion:item.version,publicReason:"user_requested_irreversible_forget",confirmation:"FORGET"},session);
    const plan=await f.kernel.privacyCopyPreview(session);f.kernel.close();
    await api.open({projectPath:f.root});
    const result=await api.execute({action:"privacy_cleanup",projectId:f.projectId,planHash:plan.planHash,resume:false,confirmed:true,copyAction:"retire"});
    expect(result).toMatchObject({status:"complete_retained",details:{copyAction:"retire",restoresBlocked:true,pagesPurged:true}});
    for(const file of plan.files) await expect(access(join(f.root,".sestina",file.locationToken))).resolves.toBeUndefined();
    api.close();await f.restart();
    expect(f.kernel.privacyStatus(session).status).toBe("complete_retained");
    await expect(restoreKernelPreMigrationBackup(f.root)).rejects.toThrow();
    expect(f.kernel.memory(session).items[0]!.item.state).toBe("forgotten");
  }finally{api.close();await f.cleanup();}
});
it("G7: cleanup failure cannot resurrect forgotten content; an approved inventory resumes and removes controlled copies", async () => {
  const f = await applicationFixture();
  try {
    f.kernel.governMemory(
      ids.create("rpev_"),
      1,
      {
        action: "create",
        kind: "working_hint",
        content: { text: "SYNTHETIC_FREE_PAGE_ERASURE_735" },
        retention: { policy: "until_unpinned" },
        sensitivity: "secret_never_send",
        outboundPolicy: "never_send",
        publicReason: "Local context",
      },
      session,
    );
    const item = f.kernel.memory(session).items[0]!.item;
    f.kernel.governMemory(
      ids.create("rpev_"),
      2,
      {
        action: "forget",
        itemId: item.id,
        expectedVersion: item.version,
        publicReason: "user_requested_irreversible_forget",
        confirmation: "FORGET",
      },
      session,
    );
    expect(f.kernel.privacyStatus(session).status).toBe("cleanup_required");
    const plan = await f.kernel.privacyCopyPreview(session);
    expect(plan.files.length).toBeGreaterThan(0);
    expect(plan.blocked).toEqual([]);
    let first = true;
    await expect(
      cleanupKernelPrivacyCopies(
        f.kernel.database,
        f.projectId,
        plan.planHash,
        false,
        () => {
          if (first) {
            first = false;
            throw new Error("synthetic file failure");
          }
        },
      ),
    ).rejects.toThrow("synthetic file failure");
    await f.restart();
    expect(f.kernel.memory(session).items[0]!.item.state).toBe("forgotten");
    expect(f.kernel.privacyStatus(session).status).toBe("cleanup_required");
    await expect(restoreKernelPreMigrationBackup(f.root)).rejects.toThrow();
    expect(
      (await f.kernel.cleanupPrivacy(plan.planHash, true, session)).status,
    ).toBe("complete");
    for (const file of plan.files)
      await expect(
        access(join(f.root, ".sestina", ...file.locationToken.split("/"))),
      ).rejects.toThrow();
    const bytes = await readFile(join(f.root, ".sestina", "state.sqlite"));
    expect(bytes.includes(Buffer.from("SYNTHETIC_FREE_PAGE_ERASURE_735"))).toBe(
      false,
    );
    await f.restart();
    expect(f.kernel.privacyStatus(session).status).toBe("complete");
    expect(f.kernel.memory(session).projectStateRevision).toBe(3);
  } finally {
    await f.cleanup();
  }
});
