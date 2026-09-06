import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const commit = "caf893db7928bab91c4098eb04a7e4a8d4c62ffe";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (args, cwd = root) =>
  execFileSync("git", args, {
    cwd,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
const lockPath = join(root, "tests/post-0.2/legacy-release-provenance.json");
const sourceArchiveSha256 = sha(git(["archive", commit]));
const recipeSha256 = sha(await readFile(import.meta.filename));

if (process.argv.includes("--verify-inputs")) {
  const proof = JSON.parse(await readFile(lockPath, "utf8"));
  if (
    proof.sourceCommit !== commit ||
    proof.sourceArchiveSha256 !== sourceArchiveSha256 ||
    proof.recipeSha256 !== recipeSha256 ||
    proof.evidenceClass !== "rebuilt_legacy_release_fixture" ||
    !proof.files.length ||
    proof.files.some((f) => !/^[a-f0-9]{64}$/.test(f.sha256))
  )
    throw Error("Pinned legacy release provenance changed");
  console.log(
    "Pinned old release source and recipe verified; this is a rebuild fixture, not an assertion about downloaded GitHub Release bytes.",
  );
} else {
  if (!process.argv[2] || process.argv[2].startsWith("--"))
    throw Error(
      "Usage: node scripts/materialize-post-0.2-release.mjs <pinned-source-worktree-under-.tmp> [--freeze]",
    );
  const source = await realpath(resolve(process.argv[2]));
  const scope = relative(join(root, ".tmp"), source);
  if (
    !scope ||
    scope.startsWith("..") ||
    resolve(root, ".tmp", scope) !== source
  )
    throw Error(
      "Legacy release builds require an isolated source under this checkout's .tmp directory",
    );
  if (
    git(["rev-parse", "HEAD"], source).toString().trim() !== commit ||
    git(["status", "--porcelain", "--untracked-files=no"], source).length
  )
    throw Error("Source must be the exact clean pinned release commit");
  const require = createRequire(join(source, "package.json"));
  // All Sestina code comes from the old source; only installed third-party
  // dependencies may be shared. Reject accidental links to the new runtime.
  for (const group of ["packages", "apps", "integrations"])
    for (const entry of await readdir(join(source, group), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const folder = join(source, group, entry.name);
      let pkg;
      try {
        pkg = JSON.parse(await readFile(join(folder, "package.json"), "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      const resolveFrom = createRequire(join(folder, "package.json"));
      for (const name of Object.keys({
        ...pkg.dependencies,
        ...pkg.devDependencies,
      }).filter((n) => n.startsWith("@sestina/"))) {
        const resolved = await realpath(resolveFrom.resolve(name));
        if (relative(source, resolved).startsWith(".."))
          throw Error(`Legacy code escaped the pinned source: ${name}`);
      }
    }
  async function buildAndRead() {
    execFileSync(
      process.execPath,
      [join(source, "scripts/build-release.mjs")],
      { cwd: source, windowsHide: true, stdio: "inherit" },
    );
    const directory = join(source, "release"),
      files = [];
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (!entry.isFile()) throw Error("Unexpected release entry");
      const bytes = await readFile(join(directory, entry.name));
      files.push({ file: entry.name, bytes: bytes.length, sha256: sha(bytes) });
    }
    return files;
  }
  const first = await buildAndRead(),
    second = await buildAndRead();
  if (JSON.stringify(first) !== JSON.stringify(second))
    throw Error("Pinned release rebuild is not deterministic");
  const proof = {
    sourceCommit: commit,
    sourceArchiveSha256,
    recipeSha256,
    evidenceClass: "rebuilt_legacy_release_fixture",
    platform: process.platform,
    architecture: process.arch,
    toolchain: {
      node: process.versions.node,
      esbuild: require("esbuild/package.json").version,
      typescript: require("typescript/package.json").version,
    },
    semantics: {
      product: "local_loopback_preview",
      databaseSchema: 20,
      electron: false,
      downloadedReleaseBytesClaimed: false,
    },
    files: first,
  };
  if (process.argv.includes("--freeze"))
    await writeFile(lockPath, JSON.stringify(proof, null, 2) + "\n");
  else if (
    JSON.stringify(proof) !==
    JSON.stringify(JSON.parse(await readFile(lockPath, "utf8")))
  )
    throw Error(
      "Old release fixture differs from its pinned provenance; do not replace the lock to hide drift",
    );
  console.log(
    "Exact old release source rebuilt twice; archive and provenance hashes match the immutable fixture declaration.",
  );
}
