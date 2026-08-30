import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { SESTINA_RELEASE_IDENTITY } from "../../packages/schema/src/release-contract.mjs";
import { inspectTarGzip, inspectZip } from "./archive.mjs";

const TEXT_EXTENSIONS = new Set(["", ".css", ".html", ".js", ".json", ".md", ".mjs", ".txt"]);
const FORBIDDEN_CONTENT = Object.freeze([
  /SESTINA_SYNTHETIC_SECRET_DO_NOT_SHIP/u,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /gh[pousr]_[A-Za-z0-9]{20,}/u,
  /AKIA[0-9A-Z]{16}/u,
  /[A-Za-z]:\\Users\\/u,
  /D:\\Codex work/u,
  /\/Users\/[^/\s]+\//u,
]);
const FORBIDDEN_SEGMENTS = new Set([".git", ".sestina", "src", "test", "tests", "fixtures"]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function exactKeys(value, expected, label) {
  invariant(typeof value === "object" && value !== null && !Array.isArray(value), `${label}_must_be_object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  invariant(JSON.stringify(actual) === JSON.stringify(wanted), `${label}_keys_invalid:${actual.join(",")}`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function positiveInteger(value, label) {
  invariant(Number.isSafeInteger(value) && value >= 1, `${label}_invalid`);
}

function sortedUniqueStrings(values, label) {
  invariant(Array.isArray(values) && values.length > 0 && values.every((value) => typeof value === "string" && value.length > 0), `${label}_invalid`);
  const sorted = [...values].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  invariant(JSON.stringify(values) === JSON.stringify(sorted) && new Set(values).size === values.length, `${label}_not_unique_sorted`);
}

function safeArtifactName(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9.-]+$/u.test(value) && !value.includes("..");
}

function validateIdentity(identity) {
  exactKeys(identity, [
    "schemaVersion", "product", "productId", "package", "cliPackage", "primaryInterface", "businessKernel",
    "releaseChannel", "version", "nodeRange", "runtimeVersion", "reportSchemaVersion", "capsuleResponseSchemaVersion",
    "mcpServerVersion", "mcpResearchContextSchemaVersion", "checkerBuildContract", "supportedSchemaMinimum",
    "futureSchemaPolicy", "downgradeSupported", "databaseSchemaVersion", "migrationManifestVersion", "migrationCount",
    "migrationManifestHash", "releaseBuildId",
  ], "release_identity");
  invariant(JSON.stringify(identity) === JSON.stringify(SESTINA_RELEASE_IDENTITY), "release_identity_not_canonical");
  positiveInteger(identity.databaseSchemaVersion, "database_schema_version");
  positiveInteger(identity.migrationCount, "migration_count");
  invariant(/^[a-f0-9]{64}$/u.test(identity.migrationManifestHash), "migration_manifest_hash_invalid");
  invariant(/^[a-f0-9]{64}$/u.test(identity.releaseBuildId), "release_build_id_invalid");
}

export function validateReleaseManifest(manifest) {
  exactKeys(manifest, ["schemaVersion", "identity", "platform", "source", "distribution", "compatibility", "contents", "security", "artifacts"], "release_manifest");
  invariant(manifest.schemaVersion === "3.0.0", "release_manifest_version_invalid");
  validateIdentity(manifest.identity);

  exactKeys(manifest.platform, ["os", "architecture", "nativeSecretBackend"], "release_platform");
  invariant(["win32", "darwin", "linux"].includes(manifest.platform.os), "release_platform_os_invalid");
  invariant(
    (manifest.platform.os === "win32" && manifest.platform.architecture === "x64")
      || (manifest.platform.os === "darwin" && manifest.platform.architecture === "arm64")
      || (manifest.platform.os === "linux" && manifest.platform.architecture === "x64"),
    "release_platform_architecture_invalid",
  );
  const backend = manifest.platform.os === "win32" ? "windows-dpapi-current-user"
    : manifest.platform.os === "darwin" ? "macos-keychain-current-user" : "linux-secret-service-current-user";
  invariant(manifest.platform.nativeSecretBackend === backend, "release_native_secret_backend_invalid");

  exactKeys(manifest.source, ["gitCommit"], "release_source");
  invariant(/^[a-f0-9]{40}$/u.test(manifest.source.gitCommit), "release_source_commit_invalid");
  const platformSlugs = {
    "win32-x64": "windows-x64",
    "darwin-arm64": "macos-arm64",
    "linux-x64": "ubuntu-x64",
  };
  const platformSlug = platformSlugs[`${manifest.platform.os}-${manifest.platform.architecture}`];
  exactKeys(manifest.distribution, ["license", "repository", "tag", "releaseUrl", "platformSlug", "primaryArtifact"], "release_distribution");
  invariant(manifest.distribution.license === "Apache-2.0"
    && manifest.distribution.repository === "https://github.com/Roblis0n/Sestina"
    && manifest.distribution.tag === "v0.2.0"
    && manifest.distribution.releaseUrl === "https://github.com/Roblis0n/Sestina/releases/tag/v0.2.0"
    && manifest.distribution.platformSlug === platformSlug, "release_distribution_invalid");
  exactKeys(manifest.compatibility, ["nodeRange", "supportedSchemaMinimum", "supportedSchemaMaximum", "futureSchemaPolicy", "downgradeSupported"], "release_compatibility");
  invariant(manifest.compatibility.nodeRange === manifest.identity.nodeRange
    && manifest.compatibility.supportedSchemaMinimum === manifest.identity.supportedSchemaMinimum
    && manifest.compatibility.supportedSchemaMaximum === manifest.identity.databaseSchemaVersion
    && manifest.compatibility.futureSchemaPolicy === "fail_closed"
    && manifest.compatibility.downgradeSupported === false, "release_compatibility_invalid");

  exactKeys(manifest.contents, ["releaseBundleRoot", "releaseBundlePaths", "executablePaths"], "release_contents");
  const expectedRoot = `sestina-research-room-${manifest.identity.version}-${platformSlug}`;
  invariant(manifest.contents.releaseBundleRoot === expectedRoot, "release_bundle_root_invalid");
  sortedUniqueStrings(manifest.contents.releaseBundlePaths, "release_bundle_paths");
  sortedUniqueStrings(manifest.contents.executablePaths, "release_executable_paths");
  invariant(manifest.contents.releaseBundlePaths.every((path) => path.startsWith(`${expectedRoot}/`)), "release_bundle_path_outside_root");
  invariant(JSON.stringify(manifest.contents.executablePaths) === JSON.stringify([
    `${expectedRoot}/app/main.js`, `${expectedRoot}/app/mcp/main.js`, `${expectedRoot}/start.mjs`,
  ].sort((left, right) => left.localeCompare(right, "en"))), "release_executable_paths_invalid");

  exactKeys(manifest.security, [
    "bindAddress", "localOnly", "offlineCapable", "telemetry", "crashUpload", "backgroundLogging", "networkUpload",
    "updateCheck", "postinstall", "containsSourceMaps", "containsResearchData", "containsCredentials",
    "uninstallDeletesProjectData", "npmPublished",
  ], "release_security");
  const expectedSecurity = {
    bindAddress: "127.0.0.1", localOnly: true, offlineCapable: true, telemetry: false, crashUpload: false,
    backgroundLogging: false, networkUpload: false, updateCheck: false, postinstall: false, containsSourceMaps: false,
    containsResearchData: false, containsCredentials: false, uninstallDeletesProjectData: false, npmPublished: false,
  };
  invariant(JSON.stringify(manifest.security) === JSON.stringify(expectedSecurity), "release_security_contract_invalid");

  invariant(Array.isArray(manifest.artifacts) && manifest.artifacts.length === 2, "release_artifacts_invalid");
  const expectedArtifacts = new Map([
    [`${expectedRoot}.tar.gz`, "platform-tar-gzip"],
    [`${expectedRoot}.zip`, "platform-zip"],
  ]);
  for (const artifact of manifest.artifacts) {
    exactKeys(artifact, ["file", "kind", "sha256", "size"], "release_artifact");
    invariant(safeArtifactName(artifact.file) && expectedArtifacts.get(artifact.file) === artifact.kind, "release_artifact_name_or_kind_invalid");
    invariant(/^[a-f0-9]{64}$/u.test(artifact.sha256), "release_artifact_hash_invalid");
    positiveInteger(artifact.size, "release_artifact_size");
    expectedArtifacts.delete(artifact.file);
  }
  invariant(expectedArtifacts.size === 0, "release_artifact_missing");
  const expectedPrimaryArtifact = manifest.platform.os === "win32" ? `${expectedRoot}.zip` : `${expectedRoot}.tar.gz`;
  invariant(manifest.distribution.primaryArtifact === expectedPrimaryArtifact, "release_primary_artifact_invalid");
}

function extension(path) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLocaleLowerCase("en-US");
}

export function scanReleaseEntries(entries) {
  for (const entry of entries) {
    const normalized = entry.path.replaceAll("\\", "/");
    const segments = normalized.split("/");
    invariant(!segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment.toLocaleLowerCase("en-US"))), `forbidden_release_path:${normalized}`);
    invariant(!/\.(?:db|sqlite3?|log|pem|key|p12|map)$/iu.test(normalized), `forbidden_release_path:${normalized}`);
    invariant(!/(?:^|\/)\.env(?:\.|$)/iu.test(normalized), `forbidden_release_path:${normalized}`);
    invariant(!/(?:^|\/)(?:credentials?|secrets?)(?:\.|$)/iu.test(normalized), `forbidden_release_path:${normalized}`);
    if (TEXT_EXTENSIONS.has(extension(normalized))) {
      const text = entry.data.toString("utf8");
      for (const pattern of FORBIDDEN_CONTENT) invariant(!pattern.test(text), `forbidden_release_content:${normalized}`);
    }
  }
}

function entryMap(entries) {
  return new Map(entries.map((entry) => [entry.path, entry]));
}

function assertRequiredPath(paths, path, label = "release_bundle_runtime_missing") {
  invariant(paths.has(path), `${label}:${path}`);
}

export function verifyReleaseBundleEntries(entries, manifest) {
  const expectedPaths = manifest.contents.releaseBundlePaths;
  invariant(JSON.stringify(entries.map((entry) => entry.path)) === JSON.stringify(expectedPaths), "release_bundle_paths_mismatch");
  scanReleaseEntries(entries);
  const files = entryMap(entries);
  const root = manifest.contents.releaseBundleRoot;
  for (const path of [
    `${root}/package.json`, `${root}/start.mjs`, `${root}/RELEASE-IDENTITY.json`, `${root}/LICENSE`, `${root}/README.md`,
    `${root}/docs/INSTALL-WINDOWS.md`, `${root}/docs/INSTALL-MACOS.md`, `${root}/docs/INSTALL-LINUX.md`,
    `${root}/docs/RECOVERY-AND-UPGRADE.md`, `${root}/docs/SECURITY.md`, `${root}/docs/THIRD-PARTY-NOTICES.md`,
    `${root}/docs/RELEASE-NOTES.md`, `${root}/docs/SUPPORT.md`,
    `${root}/app/main.js`, `${root}/app/server.js`, `${root}/app/mcp/main.js`, `${root}/app/mcp/runtime.js`, `${root}/app/client/index.html`,
  ]) assertRequiredPath(files, path);
  invariant([...files.keys()].some((path) => path.startsWith(`${root}/app/client/assets/`) && path.endsWith(".js")), "release_client_javascript_missing");
  invariant([...files.keys()].some((path) => path.startsWith(`${root}/app/client/assets/`) && path.endsWith(".css")), "release_client_styles_missing");

  const packageJson = JSON.parse(files.get(`${root}/package.json`).data.toString("utf8"));
  exactKeys(packageJson, ["name", "version", "private", "description", "license", "type", "engines", "scripts"], "release_package_manifest");
  invariant(packageJson.name === manifest.identity.package && packageJson.version === manifest.identity.version
    && packageJson.private === true && packageJson.license === "Apache-2.0" && packageJson.type === "module"
    && JSON.stringify(packageJson.engines) === JSON.stringify({ node: manifest.identity.nodeRange })
    && JSON.stringify(packageJson.scripts) === JSON.stringify({ start: "node start.mjs" }), "release_package_identity_invalid");
  const releaseIdentity = JSON.parse(files.get(`${root}/RELEASE-IDENTITY.json`).data.toString("utf8"));
  invariant(JSON.stringify(releaseIdentity) === JSON.stringify({
    ...manifest.identity,
    platform: manifest.platform.os,
    architecture: manifest.platform.architecture,
    nativeSecretBackend: manifest.platform.nativeSecretBackend,
  }), "release_embedded_identity_invalid");

  for (const path of manifest.contents.executablePaths) invariant(files.get(path)?.mode === 0o755, `release_executable_mode_invalid:${path}`);
  if (manifest.platform.os === "win32") {
    assertRequiredPath(files, `${root}/node_modules/@primno/dpapi/package.json`, "release_dpapi_runtime_missing");
    assertRequiredPath(files, `${root}/node_modules/@primno/dpapi/prebuilds/win32-${manifest.platform.architecture}/@primno+dpapi.node`, "release_dpapi_runtime_missing");
    assertRequiredPath(files, `${root}/node_modules/node-gyp-build/node-gyp-build.js`, "release_dpapi_runtime_missing");
  } else {
    const nativePackage = manifest.platform.os === "darwin"
      ? `keyring-darwin-${manifest.platform.architecture}`
      : `keyring-linux-${manifest.platform.architecture}-gnu`;
    assertRequiredPath(files, `${root}/node_modules/@napi-rs/keyring/package.json`, "release_keyring_runtime_missing");
    invariant([...files.keys()].some((path) => path.startsWith(`${root}/node_modules/@napi-rs/${nativePackage}/`) && path.endsWith(".node")), "release_keyring_native_binary_missing");
  }
}

export function parseChecksums(content) {
  const lines = content.split(/\r?\n/u).filter(Boolean);
  invariant(lines.length > 0, "sha256sums_empty");
  const result = new Map();
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  ((?:[A-Za-z0-9][A-Za-z0-9._-]*)(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*)$/u.exec(line);
    invariant(match !== null && !result.has(match[2]), "sha256sums_format_invalid");
    result.set(match[2], match[1]);
  }
  return result;
}

function sameEntries(left, right) {
  invariant(left.length === right.length, "release_archive_entry_count_drift");
  for (let index = 0; index < left.length; index += 1) {
    invariant(left[index].path === right[index].path && left[index].mode === right[index].mode
      && left[index].data.equals(right[index].data), `release_archive_content_drift:${left[index]?.path ?? index}`);
  }
}

export async function verifyReleaseDirectory(releaseDirectory) {
  const manifestBytes = await readFile(join(releaseDirectory, "release-manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  validateReleaseManifest(manifest);
  const actualTopLevel = (await readdir(releaseDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));
  const expectedTopLevel = ["SHA256SUMS", "release-manifest.json", ...manifest.artifacts.map((artifact) => artifact.file)]
    .sort((left, right) => left.localeCompare(right, "en"));
  invariant(JSON.stringify(actualTopLevel) === JSON.stringify(expectedTopLevel), "release_directory_files_invalid");
  const checksums = parseChecksums(await readFile(join(releaseDirectory, "SHA256SUMS"), "utf8"));
  invariant(checksums.size === manifest.artifacts.length + 1, "sha256sums_file_count_invalid");
  invariant(checksums.get("release-manifest.json") === sha256(manifestBytes), "release_manifest_checksum_mismatch");
  for (const artifact of manifest.artifacts) {
    const path = join(releaseDirectory, artifact.file);
    const bytes = await readFile(path);
    invariant((await stat(path)).isFile() && bytes.length === artifact.size, `release_artifact_size_mismatch:${artifact.file}`);
    invariant(sha256(bytes) === artifact.sha256 && checksums.get(artifact.file) === artifact.sha256, `release_artifact_checksum_mismatch:${artifact.file}`);
  }
  const tar = manifest.artifacts.find((artifact) => artifact.kind === "platform-tar-gzip");
  const zip = manifest.artifacts.find((artifact) => artifact.kind === "platform-zip");
  const tarEntries = await inspectTarGzip(join(releaseDirectory, tar.file));
  const zipEntries = await inspectZip(join(releaseDirectory, zip.file));
  verifyReleaseBundleEntries(tarEntries, manifest);
  verifyReleaseBundleEntries(zipEntries, manifest);
  sameEntries(tarEntries, zipEntries);
  return Object.freeze({ manifest, verifiedFiles: Object.freeze(expectedTopLevel) });
}
