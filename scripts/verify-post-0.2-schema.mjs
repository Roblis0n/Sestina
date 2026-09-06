import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const root=resolve(import.meta.dirname,".."), temp=join(root,".tmp");
await mkdir(temp,{recursive:true});
const directory=await mkdtemp(join(temp,"target-schema-proof-"));
try {
 const entry=join(directory,"proof.ts"),bundle=join(directory,"proof.mjs");
 await writeFile(entry,`import {openDatabase,KERNEL_MIGRATIONS} from "@sestina/storage";import {createHash} from "node:crypto";const db=await openDatabase({path:process.argv[2],migrate:{migrations:KERNEL_MIGRATIONS}});try{const rows=db.all("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name");process.stdout.write(JSON.stringify({schema:25,sha256:createHash("sha256").update(JSON.stringify(rows)).digest("hex")}));}finally{db.close();}`);
 await build({entryPoints:[entry],outfile:bundle,bundle:true,platform:"node",format:"esm",target:"node24",banner:{js:'import {createRequire} from "node:module";const require=createRequire(import.meta.url);'},nodePaths:[join(root,"node_modules"),...(await readdir(join(root,"packages"))).map(n=>join(root,"packages",n,"node_modules"))],plugins:[{name:"public-entries",setup(b){b.onResolve({filter:/^@sestina\//},async({path})=>{const name=path.slice(9);if(!/^[a-z-]+$/.test(name))throw Error("private import");const pkg=JSON.parse(await readFile(join(root,"packages",name,"package.json"),"utf8"));return{path:resolve(root,"packages",name,pkg.exports["."])};});}}]});
 const actual=JSON.parse(execFileSync(process.execPath,[bundle,join(directory,"state.sqlite")],{cwd:root,windowsHide:true,encoding:"utf8"}));
 const lock=join(root,"packages/storage/src/migrations/kernel-target-shape.json");
 if(process.argv.includes("--freeze"))await writeFile(lock,JSON.stringify(actual,null,2)+"\n");
 else if(JSON.stringify(actual)!==JSON.stringify(JSON.parse(await readFile(lock,"utf8"))))throw Error("Target schema structure differs from the reviewed migration fingerprint");
 console.log("Schema 021–025 structure reproduced and verified.");
}finally{await rm(directory,{recursive:true,force:true});}
