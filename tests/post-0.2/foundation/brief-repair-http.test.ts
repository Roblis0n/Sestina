import { it, expect } from "vitest";
import { unlink, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applicationFixture } from "../application-fixtures.js";
import { createResearchRoomServer } from "../../../apps/research-room/src/server.js";

it("G6: explicit application repair recreates only a missing derived Brief from validated canonical state",async()=>{
  const f=await applicationFixture();f.kernel.close();
  const app=createResearchRoomServer(); const server=await app.start();
  const path=join(f.root,".sestina","research-brief.yaml");
  const call=async(route:string,body:unknown)=>{const response=await fetch(server.origin+route,{method:"POST",headers:{"Content-Type":"application/json","x-sestina-session":app.application.sessionToken},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
  try {
    const original=await readFile(path,"utf8");await unlink(path);
    expect((await call("/api/kernel/open",{projectPath:f.root})).data.ok).toBe(false);
    expect((await call("/api/kernel/repair-brief",{projectPath:f.root,confirmed:false})).status).toBe(403);
    expect((await call("/api/kernel/repair-brief",{projectPath:f.root,confirmed:true})).data).toMatchObject({ok:true,value:{status:"ready",sourceProjectStateRevision:1}});
    expect(await readFile(path,"utf8")).toBe(original);
    expect((await call("/api/kernel/open",{projectPath:f.root})).data.ok).toBe(true);
    await writeFile(path,"unknown external content");
    expect((await call("/api/kernel/repair-brief",{projectPath:f.root,confirmed:true})).data.ok).toBe(false);
    expect(await readFile(path,"utf8")).toBe("unknown external content");
  }finally{await server.close();await f.cleanup();}
});
