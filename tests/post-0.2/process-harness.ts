import { build } from "esbuild";
import { spawn } from "node:child_process";
import { readFile,readdir } from "node:fs/promises";
import { resolve,join } from "node:path";
export async function buildProcessDriver(directory:string){
 const root=resolve("."),entry=join(directory,"process-driver.mjs");
 await build({entryPoints:[resolve("tests/post-0.2/process-driver.ts")],outfile:entry,bundle:true,platform:"node",format:"esm",target:"node24",banner:{js:'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);'},nodePaths:[join(root,"node_modules"),...(await readdir(join(root,"packages"))).map(n=>join(root,"packages",n,"node_modules"))],plugins:[{name:"public-entries",setup(b){b.onResolve({filter:/^@sestina\//},async({path})=>{const name=path.slice(9);const pkg=JSON.parse(await readFile(join(root,"packages",name,"package.json"),"utf8"));return{path:resolve(root,"packages",name,pkg.exports["."])};});}}]});return entry;
}
export async function killAtCheckpoint(entry:string,args:string[]){
 const child=spawn(process.execPath,[entry,...args],{windowsHide:true,stdio:["ignore","pipe","pipe"]});let out="",err="";
 return await new Promise<Record<string,unknown>>((resolve,reject)=>{let point:Record<string,unknown>|undefined;
  const timer=setTimeout(()=>{child.kill("SIGKILL");reject(Error(`Synthetic process did not reach checkpoint: ${err}`));},25000);
  child.stdout.on("data",chunk=>{out+=chunk;if(out.includes("\n")){try{point=JSON.parse(out.split("\n")[0]!);child.kill("SIGKILL");}catch(e){reject(e);}}});child.stderr.on("data",chunk=>{err+=chunk;});
  child.on("error",e=>{clearTimeout(timer);reject(e);});child.on("exit",()=>{clearTimeout(timer);if(point)resolve(point);else reject(Error(`Child exited before checkpoint: ${err}`));});
 });
}

export async function raceAtBarrier(entry:string,root:string,projectId:string,files:string[]) {
 const children=files.map(file=>spawn(process.execPath,[entry,root,"race",file,projectId],{windowsHide:true,stdio:["pipe","pipe","pipe"]}));
 let ready=0;
 return Promise.all(children.map(child=>new Promise<{ok:boolean;error?:{code:string}}>((resolve,reject)=>{
  let buffer="",err="",result:{ok:boolean;error?:{code:string}}|undefined;
  const timer=setTimeout(()=>{children.forEach(c=>c.kill("SIGKILL"));reject(Error(`Concurrent worker failed: ${err}`));},25000);
  child.stderr.on("data",chunk=>{err+=chunk;});child.stdout.on("data",chunk=>{buffer+=chunk;while(buffer.includes("\n")){const end=buffer.indexOf("\n"),line=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(line.ready){ready++;if(ready===children.length)children.forEach(c=>c.stdin.end("x"));}else result=line;}});
  child.on("error",e=>{clearTimeout(timer);reject(e);});child.on("exit",()=>{clearTimeout(timer);if(result)resolve(result);else reject(Error(`Worker exited before result: ${err}`));});
 })));
}
