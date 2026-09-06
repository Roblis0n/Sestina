import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

// Source is pinned independently of the current checkout. No target runtime
// participates in generating old data. Only synthetic inputs are used.
export const sourceCommit = "caf893db7928bab91c4098eb04a7e4a8d4c62ffe";
const root = resolve(import.meta.dirname, "..");
const output = resolve(process.argv[2] ?? join(root, ".tmp/post-0.2-legacy"));
await mkdir(output, { recursive: true });
const old = join(output, "source"); await mkdir(old, { recursive: true });
const archive = execFileSync("git", ["archive", sourceCommit, "packages", "tsconfig.base.json"], { cwd: root, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
const archivePath = join(output, "source.tar"); await writeFile(archivePath, archive);
execFileSync("tar", ["-xf", archivePath, "-C", old], { windowsHide: true });
const bundle = join(output, "generate.mjs");
await build({ entryPoints: [join(root, "tests/post-0.2/legacy-driver.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm", target: "node24",
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  nodePaths: [join(root, "node_modules"), ...(await readdir(join(root, "packages"))).map((name) => join(root, "packages", name, "node_modules"))],
  plugins: [{ name: "pinned-old-public-entries", setup(b) {
    b.onResolve({ filter: /^@sestina\// }, async ({ path }) => {
      const name = path.slice("@sestina/".length);
      if (!/^[a-z-]+$/.test(name)) throw new Error("Fixture imports must use public package entries");
      const pkg = JSON.parse(await readFile(join(old, "packages", name, "package.json"), "utf8"));
      return { path: resolve(old, "packages", name, pkg.exports["."]) };
    });
    b.onResolve({ filter: /^legacy-scenario$/ }, () => ({ path: join(old, "packages/research-store/test/fixtures.ts") }));
  } }], metafile: true,
});
execFileSync(process.execPath, [bundle, output], { cwd: root, windowsHide: true, stdio: "inherit" });
const generated = JSON.parse(await readFile(join(output, "hashes.json"), "utf8"));
const recipeSha256 = createHash("sha256").update(await readFile(join(root, "tests/post-0.2/legacy-driver.ts"))).digest("hex");
const proof = { sourceCommit, sourceArchiveSha256: createHash("sha256").update(archive).digest("hex"), recipeSha256, evidenceClass: "synthetic_fixture", fixtures: generated };
const lock = join(root, "tests/post-0.2/legacy-provenance.json");
if (process.argv.includes("--freeze")) await writeFile(lock, JSON.stringify(proof, null, 2) + "\n");
else if (JSON.stringify(proof) !== JSON.stringify(JSON.parse(await readFile(lock, "utf8")))) throw new Error("Old fixture provenance/hash mismatch; do not regenerate the lock with new runtime data.");
console.log("Pinned v0.2.0 synthetic compatibility corpus materialized and verified.");
