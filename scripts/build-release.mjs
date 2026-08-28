import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";
import { SESTINA_RELEASE_IDENTITY } from "../packages/schema/src/release-contract.mjs";
import { createDeterministicTarGzip, createDeterministicZip } from "./lib/archive.mjs";
import { verifyReleaseDirectory } from "./lib/release-verifier.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const releaseDirectory = join(repositoryRoot, "release");
const stagingDirectory = join(repositoryRoot, ".release-ri53-staging");
const identity = SESTINA_RELEASE_IDENTITY;
const platform = process.platform;
const architecture = process.arch;
const platformSlug = `${platform}-${architecture}`;
const root = `sestina-research-room-${identity.version}-${platformSlug}`;
const tarName = `${root}.tar.gz`;
const zipName = `${root}.zip`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function fileEntry(sourcePath, archivePath, mode = 0o644) {
  const metadata = await stat(sourcePath);
  invariant(metadata.isFile(), `release_source_not_file:${sourcePath}`);
  return Object.freeze({ path: archivePath.replaceAll("\\", "/"), data: await readFile(sourcePath), mode });
}

async function repositoryEntry(source, archivePath, mode = 0o644) {
  return fileEntry(join(repositoryRoot, source), archivePath, mode);
}

async function directoryEntries(sourceDirectory, archivePrefix) {
  const entries = [];
  async function visit(directory) {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const sourcePath = join(directory, item.name);
      const archivePath = `${archivePrefix}/${relative(sourceDirectory, sourcePath).replaceAll("\\", "/")}`;
      if (item.isDirectory()) await visit(sourcePath);
      else if (item.isFile()) entries.push(await fileEntry(sourcePath, archivePath, item.name === "main.js" ? 0o755 : 0o644));
      else throw new Error(`release_source_link_or_special_file:${sourcePath}`);
    }
  }
  await visit(sourceDirectory);
  return entries;
}

function packageRoot(packageJsonPath) {
  return dirname(packageJsonPath);
}

async function selectedFiles(sourceRoot, archiveRoot, files) {
  return Promise.all(files.map((file) => fileEntry(join(sourceRoot, file), `${archiveRoot}/${file}`)));
}

async function nativeRuntimeEntries() {
  const secretRequire = createRequire(join(repositoryRoot, "packages/secrets/package.json"));
  if (platform === "win32") {
    invariant(["x64", "arm64"].includes(architecture), `unsupported_release_architecture:${platform}-${architecture}`);
    const dpapiRoot = packageRoot(secretRequire.resolve("@primno/dpapi/package.json"));
    const dpapiRequire = createRequire(join(dpapiRoot, "package.json"));
    const nodeGypBuildRoot = packageRoot(dpapiRequire.resolve("node-gyp-build/package.json"));
    return {
      nativeSecretBackend: "windows-dpapi-current-user",
      entries: [
        ...await selectedFiles(dpapiRoot, `${root}/node_modules/@primno/dpapi`, [
          "package.json", "LICENSE", "dist/index.js", `prebuilds/win32-${architecture}/@primno+dpapi.node`,
        ]),
        ...await selectedFiles(nodeGypBuildRoot, `${root}/node_modules/node-gyp-build`, [
          "package.json", "LICENSE", "index.js", "node-gyp-build.js",
        ]),
      ],
    };
  }

  invariant(platform === "darwin" || platform === "linux", `unsupported_release_platform:${platform}`);
  invariant(["x64", "arm64"].includes(architecture), `unsupported_release_architecture:${platform}-${architecture}`);
  const keyringRoot = packageRoot(secretRequire.resolve("@napi-rs/keyring/package.json"));
  const keyringRequire = createRequire(join(keyringRoot, "package.json"));
  const nativePackage = platform === "darwin"
    ? `@napi-rs/keyring-darwin-${architecture}`
    : `@napi-rs/keyring-linux-${architecture}-gnu`;
  const nativeRoot = packageRoot(keyringRequire.resolve(`${nativePackage}/package.json`));
  const nativeFiles = (await readdir(nativeRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && ["package.json", "README.md"].includes(entry.name) || entry.isFile() && entry.name.endsWith(".node"))
    .map((entry) => entry.name)
    .sort();
  invariant(nativeFiles.some((file) => file.endsWith(".node")), "native_keyring_binary_missing");
  return {
    nativeSecretBackend: platform === "darwin" ? "macos-keychain-current-user" : "linux-secret-service-current-user",
    entries: [
      ...await selectedFiles(keyringRoot, `${root}/node_modules/@napi-rs/keyring`, [
        "package.json", "LICENSE", "index.js", "keytar.js",
      ]),
      ...await selectedFiles(nativeRoot, `${root}/node_modules/${nativePackage}`, nativeFiles),
    ],
  };
}

function artifactPackageJson() {
  return {
    name: identity.package,
    version: identity.version,
    private: true,
    description: "Sestina Research Room private release candidate",
    license: "UNLICENSED",
    type: "module",
    engines: { node: identity.nodeRange },
    scripts: { start: "node start.mjs" },
  };
}

function launcherSource() {
  const release = JSON.stringify({ ...identity, platform, architecture });
  return `#!/usr/bin/env node
const release = Object.freeze(${release});
const [major] = process.versions.node.split(".").map(Number);
if (major !== 24) {
  process.stderr.write("Sestina Research Room requires Node.js 24.x.\\n");
  process.exitCode = 1;
} else if (process.platform !== release.platform || process.arch !== release.architecture) {
  process.stderr.write(\`This artifact targets \${release.platform}-\${release.architecture}; current host is \${process.platform}-\${process.arch}.\\n\`);
  process.exitCode = 1;
} else if (process.argv.includes("--version")) {
  if (process.argv.includes("--json")) process.stdout.write(JSON.stringify(release) + "\\n");
  else process.stdout.write(\`\${release.product} \${release.version} (\${release.releaseBuildId})\\n\`);
} else {
  await import("./app/main.js");
}
`;
}

async function build() {
  await rm(stagingDirectory, { recursive: true, force: true });
  await mkdir(stagingDirectory, { recursive: true });
  try {
    await import(new URL(`./build-research-room.mjs?release=${identity.releaseBuildId}`, import.meta.url));
    const nativeRuntime = await nativeRuntimeEntries();
    const bundleEntries = [
      { path: `${root}/package.json`, data: Buffer.from(`${JSON.stringify(artifactPackageJson(), null, 2)}\n`), mode: 0o644 },
      { path: `${root}/start.mjs`, data: Buffer.from(launcherSource()), mode: 0o755 },
      { path: `${root}/RELEASE-IDENTITY.json`, data: Buffer.from(`${JSON.stringify({ ...identity, platform, architecture, nativeSecretBackend: nativeRuntime.nativeSecretBackend }, null, 2)}\n`), mode: 0o644 },
      await repositoryEntry("docs/release/README.md", `${root}/README.md`),
      await repositoryEntry("docs/release/INSTALL-WINDOWS.md", `${root}/docs/INSTALL-WINDOWS.md`),
      await repositoryEntry("docs/release/INSTALL-MACOS.md", `${root}/docs/INSTALL-MACOS.md`),
      await repositoryEntry("docs/release/INSTALL-LINUX.md", `${root}/docs/INSTALL-LINUX.md`),
      await repositoryEntry("docs/release/RECOVERY-AND-UPGRADE.md", `${root}/docs/RECOVERY-AND-UPGRADE.md`),
      await repositoryEntry("docs/release/SECURITY.md", `${root}/docs/SECURITY.md`),
      await repositoryEntry("apps/research-room/dist/main.js", `${root}/app/main.js`, 0o755),
      await repositoryEntry("apps/research-room/dist/server.js", `${root}/app/server.js`),
      ...await directoryEntries(join(repositoryRoot, "apps/research-room/dist/client"), `${root}/app/client`),
      ...await directoryEntries(join(repositoryRoot, "apps/research-room/dist/mcp"), `${root}/app/mcp`),
      ...nativeRuntime.entries,
    ].sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
    await createDeterministicTarGzip(join(stagingDirectory, tarName), bundleEntries);
    await createDeterministicZip(join(stagingDirectory, zipName), bundleEntries);

    const artifactSpecs = [[tarName, "platform-tar-gzip"], [zipName, "platform-zip"]];
    const artifacts = await Promise.all(artifactSpecs.map(async ([file, kind]) => {
      const bytes = await readFile(join(stagingDirectory, file));
      return { file, kind, sha256: sha256(bytes), size: bytes.length };
    }));
    artifacts.sort((left, right) => left.file.localeCompare(right.file, "en"));
    const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8", windowsHide: true }).trim();
    const manifest = {
      schemaVersion: "2.0.0",
      identity,
      platform: { os: platform, architecture, nativeSecretBackend: nativeRuntime.nativeSecretBackend },
      source: { gitCommit: sourceCommit },
      compatibility: {
        nodeRange: identity.nodeRange,
        supportedSchemaMinimum: identity.supportedSchemaMinimum,
        supportedSchemaMaximum: identity.databaseSchemaVersion,
        futureSchemaPolicy: identity.futureSchemaPolicy,
        downgradeSupported: identity.downgradeSupported,
      },
      contents: {
        releaseBundleRoot: root,
        releaseBundlePaths: bundleEntries.map((entry) => entry.path),
        executablePaths: [`${root}/app/main.js`, `${root}/app/mcp/main.js`, `${root}/start.mjs`],
      },
      security: {
        bindAddress: "127.0.0.1",
        localOnly: true,
        offlineCapable: true,
        telemetry: false,
        crashUpload: false,
        backgroundLogging: false,
        networkUpload: false,
        updateCheck: false,
        postinstall: false,
        containsSourceMaps: false,
        containsResearchData: false,
        containsCredentials: false,
        uninstallDeletesProjectData: false,
        npmPublished: false,
      },
      artifacts,
    };
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(join(stagingDirectory, "release-manifest.json"), manifestBytes);
    const sums = [...artifacts.map((artifact) => [artifact.file, artifact.sha256]), ["release-manifest.json", sha256(manifestBytes)]]
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([file, hash]) => `${hash}  ${file}`)
      .join("\n");
    await writeFile(join(stagingDirectory, "SHA256SUMS"), `${sums}\n`);
    await verifyReleaseDirectory(stagingDirectory);
    await rm(releaseDirectory, { recursive: true, force: true });
    await rename(stagingDirectory, releaseDirectory);
    process.stdout.write(`Built and verified ${artifacts.length} Sestina Research Room ${identity.version} ${platformSlug} artifacts in ${basename(releaseDirectory)}.\n`);
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

await build();
