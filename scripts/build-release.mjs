import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { SESTINA_RELEASE_IDENTITY } from "../packages/schema/src/release-contract.mjs";
import { createDeterministicTarGzip, createDeterministicZip } from "./lib/archive.mjs";
import { verifyReleaseDirectory } from "./lib/release-verifier.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const releaseDirectory = join(repositoryRoot, "release");
const stagingDirectory = join(repositoryRoot, ".release-ri42-staging");
const identity = SESTINA_RELEASE_IDENTITY; const version = identity.version;
const npmName = `sestina-cli-${version}.tgz`; const tarName = `sestina-${version}.tar.gz`; const zipName = `sestina-${version}.zip`;
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function sourceEntry(source, path, mode = 0o644) {
  return Object.freeze({ path, data: await readFile(join(repositoryRoot, source)), mode });
}

function packageManifest() {
  return {
    name: identity.package,
    version,
    private: true,
    description: "Local-first research process debugger for Codex projects",
    license: "UNLICENSED",
    type: "module",
    bin: { sestina: "./dist/main.js" },
    main: "./dist/cli.js",
    exports: { ".": "./dist/cli.js", "./package.json": "./package.json" },
    engines: { node: identity.nodeRange },
    files: ["dist/", "README.md"],
  };
}

async function build() {
  await rm(stagingDirectory, { recursive: true, force: true }); await mkdir(stagingDirectory, { recursive: true });
  try {
    await import(new URL(`./build-cli.mjs?release=${identity.releaseBuildId}`, import.meta.url));
    const npmEntries = [
      { path: "package/package.json", data: Buffer.from(`${JSON.stringify(packageManifest(), null, 2)}\n`), mode: 0o644 },
      await sourceEntry("apps/cli/README.md", "package/README.md"),
      await sourceEntry("apps/cli/dist/main.js", "package/dist/main.js", 0o755),
      await sourceEntry("apps/cli/dist/cli.js", "package/dist/cli.js"),
      await sourceEntry("apps/cli/dist/mcp/main.js", "package/dist/mcp/main.js", 0o755),
      await sourceEntry("apps/cli/dist/mcp/runtime.js", "package/dist/mcp/runtime.js"),
      await sourceEntry("apps/cli/dist/mcp/index.js", "package/dist/mcp/index.js"),
    ].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    const npmPath = join(stagingDirectory, npmName); await createDeterministicTarGzip(npmPath, npmEntries);
    const root = `sestina-${version}`;
    const bundleSources = [
      ["docs/release/README.md", `${root}/README.md`],
      ["docs/release/INSTALL-WINDOWS.md", `${root}/docs/INSTALL-WINDOWS.md`],
      ["docs/release/INSTALL-MACOS.md", `${root}/docs/INSTALL-MACOS.md`],
      ["docs/release/INSTALL-LINUX.md", `${root}/docs/INSTALL-LINUX.md`],
      ["examples/06-release-quickstart/README.md", `${root}/examples/06-release-quickstart/README.md`],
      ["examples/06-release-quickstart/RESEARCH-BRIEF.txt", `${root}/examples/06-release-quickstart/RESEARCH-BRIEF.txt`],
      ["examples/06-release-quickstart/baseline.md", `${root}/examples/06-release-quickstart/baseline.md`],
      ["examples/06-release-quickstart/candidate.md", `${root}/examples/06-release-quickstart/candidate.md`],
    ];
    const bundleEntries = await Promise.all(bundleSources.map(([source, path]) => sourceEntry(source, path)));
    bundleEntries.push({ path: `${root}/${npmName}`, data: await readFile(npmPath), mode: 0o644 });
    bundleEntries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    await createDeterministicTarGzip(join(stagingDirectory, tarName), bundleEntries);
    await createDeterministicZip(join(stagingDirectory, zipName), bundleEntries);
    const artifactSpecs = [
      [npmName, "npm-tarball"], [tarName, "portable-tar-gzip"], [zipName, "portable-zip"],
    ];
    const artifacts = await Promise.all(artifactSpecs.map(async ([file, kind]) => {
      const bytes = await readFile(join(stagingDirectory, file)); return { file, kind, sha256: sha256(bytes), size: bytes.length };
    }));
    artifacts.sort((left, right) => left.file < right.file ? -1 : left.file > right.file ? 1 : 0);
    const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8", windowsHide: true }).trim();
    const manifest = {
      schemaVersion: "1.0.0",
      identity,
      source: { gitCommit: sourceCommit },
      contents: { npmPackagePaths: npmEntries.map((entry) => entry.path), releaseBundlePaths: bundleEntries.map((entry) => entry.path) },
      security: { localOnly: true, offlineCapable: true, telemetry: false, crashUpload: false, backgroundLogging: false, networkUpload: false, postinstall: false, containsResearchData: false, containsCredentials: false, uninstallDeletesProjectData: false, npmPublished: false },
      artifacts,
    };
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`); await writeFile(join(stagingDirectory, "release-manifest.json"), manifestBytes);
    const sums = [...artifacts.map((artifact) => [artifact.file, artifact.sha256]), ["release-manifest.json", sha256(manifestBytes)]]
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([file, hash]) => `${hash}  ${file}`).join("\n");
    await writeFile(join(stagingDirectory, "SHA256SUMS"), `${sums}\n`);
    await verifyReleaseDirectory(stagingDirectory);
    await rm(releaseDirectory, { recursive: true, force: true }); await rename(stagingDirectory, releaseDirectory);
    process.stdout.write(`Built and verified ${artifacts.length} Sestina ${version} artifacts in ${basename(releaseDirectory)}.\n`);
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true }); throw error;
  }
}

await build();
