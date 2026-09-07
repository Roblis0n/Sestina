import { beforeAll, afterAll, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, cp, rm, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { migrateKernelProject, openKernelProject } from "@sestina/core";
import {
  readKernelLegacyRecord,
  readKernelSnapshot,
  createResearchStore,
} from "@sestina/research-store";
import states from "../legacy-states-provenance.json" with { type: "json" };
import { createResearchRoomServer } from "../../../apps/research-room/src/server.js";
let root: string;
let ownsRoot=false;
beforeAll(async () => {
  if(process.env.SESTINA_LEGACY_STATES_DIR){root=resolve(process.env.SESTINA_LEGACY_STATES_DIR);return;}
  await mkdir(resolve(".tmp"), { recursive: true });
  root = await mkdtemp(resolve(".tmp/old-workflow-states-"));
  ownsRoot=true;
  execFileSync(
    process.execPath,
    [resolve("scripts/materialize-post-0.2-states.mjs"), root],
    { windowsHide: true, stdio: "pipe", maxBuffer: 2097152 },
  );
}, 120000);
afterAll(async () => {
  if (root && ownsRoot) await rm(root, { recursive: true, force: true });
});
it.each(states.fixtures)(
  "G1/G2: $key is reproducible, migrates without new authority, and stays read-only",
  async (entry) => {
    const source = join(root, "states", entry.key, ".sestina");
    expect(
      createHash("sha256")
        .update(await readFile(join(source, "state.sqlite")))
        .digest("hex"),
    ).toBe(entry.databaseSha256);
    const project = await mkdtemp(join(tmpdir(), "sestina-history-copy-"));
    try {
      await cp(source, join(project, ".sestina"), { recursive: true });
      await migrateKernelProject({ projectRoot: project });
      const db = await openKernelProject(project);
      try {
        const kind = entry.key.startsWith("correction")
          ? "correction_appeals"
          : entry.key.startsWith("deliberation")
            ? "deliberation_rooms"
            : "closed_external_app_pilots";
        const old = readKernelLegacyRecord(
          db,
          entry.projectId,
          kind,
          entry.objectId,
        )!;
        expect(old.legacyPayload).toMatchObject({
          id: entry.objectId,
          status: entry.status,
        });
        expect(old.canonicalAuthority).toBe(false);
        const snapshot = readKernelSnapshot(db, entry.projectId);
        expect(snapshot.head.revision).toBe(1);
        expect(snapshot.state.objects.map((o) => o.kind)).toEqual(["project"]);
        expect(
          db.all("SELECT * FROM research_project_state_events"),
        ).toHaveLength(1);
        expect(() => db.run(`DELETE FROM ${kind}`)).toThrow();
        const store = createResearchStore(db);
        const write =
          kind === "correction_appeals"
            ? store.correctionAppeals.create(old.legacyPayload as never)
            : kind === "deliberation_rooms"
              ? store.deliberationRooms.create(old.legacyPayload as never)
              : store.closedExternalAppPilots.create(
                  old.legacyPayload as never,
                );
        expect(write.ok).toBe(false);
        if (kind === "correction_appeals")
          expect(old.classification).toBe("orphan");
      } finally {
        db.close();
      }
      // Reuse each immutable old state to prove the actual application boundary.
      const app=createResearchRoomServer(),server=await app.start();
      const post=async(path:string,body:unknown)=>{
        const response=await fetch(server.origin+path,{method:"POST",headers:{"Content-Type":"application/json","x-sestina-session":app.application.sessionToken},body:JSON.stringify(body)});
        return {status:response.status,data:await response.json()};
      };
      const kind=entry.key.startsWith("correction")?"correction_appeals":entry.key.startsWith("deliberation")?"deliberation_rooms":"closed_external_app_pilots";
      const command=async(body:unknown)=>post("/api/kernel/reviews",{projectId:entry.projectId,...body as Record<string,unknown>});
      try {
        expect((await post("/api/kernel/open",{projectPath:project})).data.ok).toBe(true);
        const history=(await command({action:"legacy_history",sourceKind:kind,limit:20})).data.value;
        expect(history.items[0].legacyPayload).toMatchObject({id:entry.objectId,status:entry.status});
        const input={action:"convert_legacy",sourceKind:kind,sourceId:entry.objectId,suggestion:"Explicitly continue this synthetic historical record"};
        const draft=(await command(input)).data.value;
        expect(draft).toMatchObject({status:"draft",source:{kind:"legacy_workflow",id:`${kind}:${entry.objectId}`},attemptIds:[],terminalOutcome:null});
        expect((await command(input)).data.value.id).toBe(draft.id);
        expect((await command({...input,suggestion:"Conflicting duplicate"})).data.ok).toBe(false);
        expect((await command({action:"brief"})).data.value.projectStateRevision).toBe(1);
        for(const route of ["/api/project/correction-appeals/create","/api/project/deliberation-rooms/create","/api/project/external-app-pilots/create"]){
          expect((await post(route,{projectId:entry.projectId}))).toMatchObject({status:409,data:{ok:false,error:{code:"legacy_workflow_read_only"}}});
        }
        expect((await command({action:"legacy_history",sourceKind:kind,limit:20})).data.value).toEqual(history);
      } finally {await server.close();}
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  },
);
