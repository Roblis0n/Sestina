import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
const root=resolve(import.meta.dirname,".."),read=path=>readFile(join(root,path),"utf8"),index=JSON.parse(await read("tests/post-0.2/discovery.json"));
const required=["P0-01","P1-01","P1-02","P1-03","P1-04","P1-05","P1-06","P2-01","P2-02"];
if(JSON.stringify(index.findings.map(f=>f.id))!==JSON.stringify(required))throw Error("Finding discovery is incomplete");
for(const f of index.findings){const source=await read(f.file);if(!source.includes(f.id)||!source.includes(f.assertion)||!source.includes("expect("))throw Error(`Missing executable assertion: ${f.id}`);}
for(const part of ["foundation","downstream"])for(const name of await readdir(join(root,"tests/post-0.2",part))){if(!/\.(test|spec)\.ts$/.test(name))continue;const source=await read(`tests/post-0.2/${part}/${name}`);if(/\b(?:it|test|describe)\.(?:skip|todo|fails|fixme)\b/.test(source))throw Error(`Forbidden failure masking: ${name}`);}
for(const path of index.immutableRecipes){const proof=JSON.parse(await read(path));if(proof.sourceCommit!==index.legacySourceCommit||!proof.fixtures.length||proof.fixtures.some(f=>f.schema<16||f.schema>20||!/^[0-9a-f]{64}$/.test(f.databaseSha256)))throw Error(`Invalid immutable legacy declaration: ${path}`);}
for(const name of index.foundationEvidence){const source=await read(`tests/post-0.2/foundation/${name}.test.ts`);if(!source.includes("expect("))throw Error(`Missing foundation evidence: ${name}`);}
console.log("All nine findings have independent, unmasked downstream entries; foundation and immutable legacy declarations are explicit. This discovery check does not mark downstream behavior GREEN.");
