import ts from "typescript";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root=resolve(import.meta.dirname,"..");
const output=resolve(process.argv[2] ?? ".tmp/post-0.2-states");
const old=join(output,"source"), sha=bytes=>createHash("sha256").update(bytes).digest("hex");
await mkdir(output,{recursive:true});
execFileSync(process.execPath,[join(root,"scripts/materialize-post-0.2-legacy.mjs"),output],{cwd:root,stdio:"inherit",windowsHide:true});
const recipes=[];
for(const kind of ["correction-appeal","deliberation-room","closed-external-app-pilot"]){
 const path=join(old,"packages/research/test",`${kind}.test.ts`), source=await readFile(path,"utf8");
 recipes.push({path:`packages/research/test/${kind}.test.ts`,sha256:sha(source)});
 const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS), names=new Set();
 for(const item of ast.statements)if(ts.isImportDeclaration(item)&&item.moduleSpecifier.text==="../src/index.js")for(const e of item.importClause?.namedBindings?.elements??[])if(!e.isTypeOnly)names.add(e.name.text);
 // Observation wraps public return values only. The pinned old functions and
 // all original Vitest assertions execute unchanged; invalid values are never stored.
 const transformed=ts.transform(ast,[context=>{const visit=node=>{const visited=ts.visitEachChild(node,visit,context);if(ts.isCallExpression(visited)&&ts.isIdentifier(visited.expression)&&names.has(visited.expression.text))return ts.factory.createCallExpression(ts.factory.createIdentifier("observeLegacyReturn"),undefined,[visited]);return visited;};return node=>ts.visitNode(node,visit);}]);
 let observed=ts.createPrinter().printFile(transformed.transformed[0]).replace('"../src/index.js"',JSON.stringify(join(old,"packages/research/src/index.ts")));
 // The shipped Pilot unit fixture reuses adjacent factory ranges and can
 // produce duplicate event IDs that its SQL repository correctly rejects.
 // Spread synthetic input ranges; production code and assertions stay pinned.
 if(kind==="closed-external-app-pilot") observed=observed.replace("new SequenceIdFactory(seed)","new SequenceIdFactory(seed * 1000)");
 transformed.dispose();
 const entry=join(output,`observe-${kind}.test.ts`);
 const harness=await readFile(join(root,"tests/post-0.2/legacy-observer.ts"),"utf8");
 await writeFile(entry,`const fixtureKind=${JSON.stringify(kind)}, fixtureOutput=${JSON.stringify(output)};\n${harness}\n${observed}`);
 const bundle=join(output,`observe-${kind}.test.mjs`);
 await build({entryPoints:[entry],outfile:bundle,bundle:true,platform:"node",format:"esm",target:"node24",external:["vitest"],banner:{js:'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);'},nodePaths:[join(root,"node_modules"),...(await readdir(join(root,"packages"))).map(n=>join(root,"packages",n,"node_modules"))],plugins:[{name:"old-runtime-only",setup(b){b.onResolve({filter:/^@sestina\//},async({path})=>{const name=path.slice(9);if(!/^[a-z-]+$/.test(name))throw Error("private import");const pkg=JSON.parse(await readFile(join(old,"packages",name,"package.json"),"utf8"));return{path:resolve(old,"packages",name,pkg.exports["."])};});}}]});
}
const config=join(output,"vitest.states.config.mjs");
await writeFile(config,`export default {test:{include:[${JSON.stringify(join(output,"observe-*.test.mjs").replaceAll("\\","/"))}],fileParallelism:false,maxWorkers:1,hookTimeout:120000,testTimeout:30000}};`);
execFileSync(process.execPath,[join(root,"node_modules/vitest/vitest.mjs"),"run","--config",config],{cwd:root,windowsHide:true,stdio:"inherit"});
const fixtures=[];for(const {path} of recipes){const kind=path.split("/").at(-1).replace(".test.ts","");fixtures.push(...JSON.parse(await readFile(join(output,`${kind}-states.json`),"utf8")));}
const proof={sourceCommit:"caf893db7928bab91c4098eb04a7e4a8d4c62ffe",observation:"Pinned public return values; original assertions executed; old parsers and repositories persist the samples. Pilot synthetic ID ranges are spaced by 1000 to avoid overlapping event IDs in the original unit-only fixture.",recipes,observerSha256:sha(await readFile(join(root,"tests/post-0.2/legacy-observer.ts"))),fixtures};
const lock=join(root,"tests/post-0.2/legacy-states-provenance.json");
if(process.argv.includes("--freeze"))await writeFile(lock,JSON.stringify(proof,null,2)+"\n");
else if(JSON.stringify(proof)!==JSON.stringify(JSON.parse(await readFile(lock,"utf8"))))throw Error("Pinned state corpus changed");
console.log(`Verified ${fixtures.length} immutable old workflow state samples.`);
