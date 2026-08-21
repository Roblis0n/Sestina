import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { extractTarGzip, inspectTarGzip, inspectZip } from "./archive.mjs";

const FORBIDDEN_CONTENT = Object.freeze([
  /SESTINA_SYNTHETIC_SECRET_DO_NOT_SHIP/u,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /gh[pousr]_[A-Za-z0-9]{20,}/u,
  /AKIA[0-9A-Z]{16}/u,
  /[A-Za-z]:\\Users\\/u,
  /D:\\Codex work/u,
]);
const FORBIDDEN_PATH = /(?:^|\/)(?:\.sestina(?:\/|$)|\.env(?:\.|$)|credentials?(?:\.|$)|secrets?(?:\.|$)|[^/]+\.(?:db|sqlite3?|log|pem|key|p12))$/iu;

function exactKeys(value, expected, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label}_must_be_object`);
  const actual = Object.keys(value).sort(); const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${label}_keys_invalid:${actual.join(",")}`);
}

function sha256(buffer) { return createHash("sha256").update(buffer).digest("hex"); }

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label}_invalid`);
}

function safeArtifactName(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9.-]+$/u.test(value) && !value.includes("..");
}

function validateIdentity(identity) {
  exactKeys(identity, [
    "schemaVersion", "package", "version", "nodeRange", "runtimeVersion", "reportSchemaVersion",
    "capsuleResponseSchemaVersion", "mcpServerVersion", "mcpResearchContextSchemaVersion",
    "checkerBuildContract", "databaseSchemaVersion", "migrationManifestVersion", "migrationCount", "releaseBuildId",
  ], "release_identity");
  for (const key of ["schemaVersion", "package", "version", "nodeRange", "runtimeVersion", "reportSchemaVersion", "capsuleResponseSchemaVersion", "mcpServerVersion", "mcpResearchContextSchemaVersion", "checkerBuildContract", "migrationManifestVersion"]) {
    if (typeof identity[key] !== "string" || identity[key].length === 0) throw new Error(`release_identity_${key}_invalid`);
  }
  positiveInteger(identity.databaseSchemaVersion, "database_schema_version"); positiveInteger(identity.migrationCount, "migration_count");
  if (!/^[a-f0-9]{64}$/u.test(identity.releaseBuildId)) throw new Error("release_build_id_invalid");
  if (identity.package !== "@sestina/cli" || identity.nodeRange !== ">=24 <25") throw new Error("release_identity_package_or_node_invalid");
  if (identity.version !== identity.runtimeVersion || identity.version !== identity.mcpServerVersion) throw new Error("release_runtime_version_drift");
}

export function validateReleaseManifest(manifest) {
  exactKeys(manifest, ["schemaVersion", "identity", "source", "contents", "security", "artifacts"], "release_manifest");
  if (manifest.schemaVersion !== "1.0.0") throw new Error("release_manifest_version_invalid");
  validateIdentity(manifest.identity);
  exactKeys(manifest.source, ["gitCommit"], "release_source");
  if (!/^[a-f0-9]{40}$/u.test(manifest.source.gitCommit)) throw new Error("release_source_commit_invalid");
  exactKeys(manifest.contents, ["npmPackagePaths", "releaseBundlePaths"], "release_contents");
  for (const key of ["npmPackagePaths", "releaseBundlePaths"]) {
    const paths = manifest.contents[key];
    if (!Array.isArray(paths) || paths.length === 0 || paths.some((path) => typeof path !== "string")) throw new Error(`release_${key}_invalid`);
    const sorted = [...paths].sort(); if (JSON.stringify(paths) !== JSON.stringify(sorted) || new Set(paths).size !== paths.length) throw new Error(`release_${key}_not_unique_sorted`);
  }
  exactKeys(manifest.security, ["localOnly", "offlineCapable", "telemetry", "crashUpload", "backgroundLogging", "networkUpload", "postinstall", "containsResearchData", "containsCredentials", "uninstallDeletesProjectData", "npmPublished"], "release_security");
  const expectedSecurity = { localOnly: true, offlineCapable: true, telemetry: false, crashUpload: false, backgroundLogging: false, networkUpload: false, postinstall: false, containsResearchData: false, containsCredentials: false, uninstallDeletesProjectData: false, npmPublished: false };
  if (JSON.stringify(manifest.security) !== JSON.stringify(expectedSecurity)) throw new Error("release_security_contract_invalid");
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 3) throw new Error("release_artifacts_invalid");
  const files = new Set();
  for (const artifact of manifest.artifacts) {
    exactKeys(artifact, ["file", "kind", "sha256", "size"], "release_artifact");
    if (!safeArtifactName(artifact.file) || files.has(artifact.file)) throw new Error("release_artifact_name_invalid");
    if (!["npm-tarball", "portable-tar-gzip", "portable-zip"].includes(artifact.kind)) throw new Error("release_artifact_kind_invalid");
    if (!/^[a-f0-9]{64}$/u.test(artifact.sha256)) throw new Error("release_artifact_hash_invalid");
    positiveInteger(artifact.size, "release_artifact_size"); files.add(artifact.file);
  }
  const version = manifest.identity.version;
  const expectedNames = [`sestina-${version}.tar.gz`, `sestina-${version}.zip`, `sestina-cli-${version}.tgz`].sort();
  if (JSON.stringify([...files].sort()) !== JSON.stringify(expectedNames)) throw new Error("release_artifact_version_drift");
}

export function scanReleaseEntries(entries) {
  for (const entry of entries) {
    if (entry.path.split("/").includes(".sestina") || FORBIDDEN_PATH.test(entry.path)) throw new Error(`forbidden_release_path:${entry.path}`);
    const content = entry.data.toString("utf8");
    if (FORBIDDEN_CONTENT.some((pattern) => pattern.test(content))) throw new Error(`forbidden_release_content:${entry.path}`);
  }
}

function entryMap(entries) { return new Map(entries.map((entry) => [entry.path, entry])); }

function expectPaths(entries, expected, label) {
  const paths = entries.map((entry) => entry.path).sort();
  if (JSON.stringify(paths) !== JSON.stringify(expected)) throw new Error(`${label}_allowlist_mismatch`);
}

export function verifyNpmPackageEntries(entries, manifest) {
  expectPaths(entries, manifest.contents.npmPackagePaths, "npm_package"); scanReleaseEntries(entries);
  if (entries.some((entry) => /\.(?:ts|tsx|map)$/iu.test(entry.path) || entry.path.includes("/src/") || entry.path.includes("node_modules"))) throw new Error("npm_package_contains_development_files");
  const byPath = entryMap(entries); const packageEntry = byPath.get("package/package.json");
  if (!packageEntry) throw new Error("npm_package_manifest_missing");
  const packageJson = JSON.parse(packageEntry.data.toString("utf8"));
  exactKeys(packageJson, ["name", "version", "private", "description", "license", "type", "bin", "main", "exports", "engines", "files"], "npm_package_manifest");
  if (packageJson.name !== manifest.identity.package || packageJson.version !== manifest.identity.version || packageJson.private !== true || packageJson.type !== "module" || packageJson.license !== "UNLICENSED") throw new Error("npm_package_identity_invalid");
  if (packageJson.main !== "./dist/cli.js" || packageJson.bin?.sestina !== "./dist/main.js" || packageJson.engines?.node !== manifest.identity.nodeRange) throw new Error("npm_package_runtime_paths_invalid");
  const serialized = JSON.stringify(packageJson); if (serialized.includes("workspace:") || serialized.includes("postinstall")) throw new Error("npm_package_workspace_or_install_script");
  for (const required of ["package/dist/main.js", "package/dist/cli.js", "package/dist/mcp/main.js", "package/dist/mcp/runtime.js", "package/dist/mcp/index.js"]) if (!byPath.has(required)) throw new Error(`npm_package_runtime_missing:${required}`);
}

function compareBundles(left, right) {
  const a = entryMap(left); const b = entryMap(right);
  if (a.size !== b.size) throw new Error("portable_bundle_count_mismatch");
  for (const [path, entry] of a) {
    const other = b.get(path); if (!other || entry.mode !== other.mode || !entry.data.equals(other.data)) throw new Error(`portable_bundle_content_mismatch:${path}`);
  }
}

export function parseChecksums(content) {
  const result = new Map();
  for (const line of content.trimEnd().split("\n")) {
    const match = /^([a-f0-9]{64})  ([a-z0-9][a-z0-9.-]+)$/u.exec(line);
    if (!match || result.has(match[2])) throw new Error("sha256sums_format_invalid"); result.set(match[2], match[1]);
  }
  return result;
}

export async function verifyReleaseDirectory(releaseDirectory) {
  const manifestBytes = await readFile(join(releaseDirectory, "release-manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8")); validateReleaseManifest(manifest);
  const expectedTop = [...manifest.artifacts.map((artifact) => artifact.file), "SHA256SUMS", "release-manifest.json"].sort();
  const actualTop = (await readdir(releaseDirectory, { withFileTypes: true }));
  if (actualTop.some((entry) => !entry.isFile()) || JSON.stringify(actualTop.map((entry) => entry.name).sort()) !== JSON.stringify(expectedTop)) throw new Error("release_directory_allowlist_mismatch");
  const checksums = parseChecksums(await readFile(join(releaseDirectory, "SHA256SUMS"), "utf8"));
  const checksumNames = [...manifest.artifacts.map((artifact) => artifact.file), "release-manifest.json"].sort();
  if (JSON.stringify([...checksums.keys()].sort()) !== JSON.stringify(checksumNames)) throw new Error("sha256sums_allowlist_mismatch");
  if (checksums.get("release-manifest.json") !== sha256(manifestBytes)) throw new Error("release_manifest_checksum_mismatch");
  for (const artifact of manifest.artifacts) {
    const bytes = await readFile(join(releaseDirectory, artifact.file)); const metadata = await stat(join(releaseDirectory, artifact.file));
    if (metadata.size !== artifact.size || sha256(bytes) !== artifact.sha256 || checksums.get(artifact.file) !== artifact.sha256) throw new Error(`release_artifact_checksum_mismatch:${artifact.file}`);
  }
  const version = manifest.identity.version; const npmPath = join(releaseDirectory, `sestina-cli-${version}.tgz`);
  const npmEntries = await inspectTarGzip(npmPath); verifyNpmPackageEntries(npmEntries, manifest);
  const tarEntries = await inspectTarGzip(join(releaseDirectory, `sestina-${version}.tar.gz`));
  const zipEntries = await inspectZip(join(releaseDirectory, `sestina-${version}.zip`));
  expectPaths(tarEntries, manifest.contents.releaseBundlePaths, "portable_tar"); expectPaths(zipEntries, manifest.contents.releaseBundlePaths, "portable_zip");
  scanReleaseEntries(tarEntries); scanReleaseEntries(zipEntries); compareBundles(tarEntries, zipEntries);
  const bundleNpmPath = `sestina-${version}/sestina-cli-${version}.tgz`; const embedded = entryMap(tarEntries).get(bundleNpmPath);
  if (!embedded || sha256(embedded.data) !== manifest.artifacts.find((item) => item.kind === "npm-tarball")?.sha256) throw new Error("portable_bundle_npm_tarball_mismatch");
  const temporary = await mkdtemp(join(tmpdir(), "sestina-release-verify-"));
  try {
    await extractTarGzip(npmPath, temporary);
    const output = execFileSync(process.execPath, [join(temporary, "package", "dist", "main.js"), "--version", "--json"], { encoding: "utf8", windowsHide: true, env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" } });
    const reported = JSON.parse(output.trim());
    if (JSON.stringify(reported) !== JSON.stringify({ ok: true, command: "version", ...manifest.identity })) throw new Error("installed_version_identity_mismatch");
  } finally { await rm(temporary, { recursive: true, force: true }); }
  return Object.freeze({ manifest, verifiedFiles: Object.freeze(expectedTop) });
}
