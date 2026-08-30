import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import { inspectTarGzip, inspectZip } from "./archive.mjs";
import {
  parseChecksums,
  validateReleaseManifest,
  verifyReleaseBundleEntries,
} from "./release-verifier.mjs";

const EXPECTED = Object.freeze([
  Object.freeze({
    key: "windows_x64",
    os: "win32",
    architecture: "x64",
    slug: "windows-x64",
    file: "sestina-research-room-0.2.0-windows-x64.zip",
    manifestFile:
      "sestina-research-room-0.2.0-windows-x64.zip.manifest.json",
  }),
  Object.freeze({
    key: "macos_arm64",
    os: "darwin",
    architecture: "arm64",
    slug: "macos-arm64",
    file: "sestina-research-room-0.2.0-macos-arm64.tar.gz",
    manifestFile:
      "sestina-research-room-0.2.0-macos-arm64.tar.gz.manifest.json",
  }),
  Object.freeze({
    key: "ubuntu_x64",
    os: "linux",
    architecture: "x64",
    slug: "ubuntu-x64",
    file: "sestina-research-room-0.2.0-ubuntu-x64.tar.gz",
    manifestFile:
      "sestina-research-room-0.2.0-ubuntu-x64.tar.gz.manifest.json",
  }),
]);

const PILOT_FILE = "sestina-research-room-0.2.0-pilot-kit.zip";
const INDEX_FILE = "release-index.json";
const SUMS_FILE = "SHA256SUMS";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function exactKeys(value, keys, label) {
  invariant(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${label}_must_be_object`,
  );
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  invariant(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label}_keys_invalid`,
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validateIndex(index) {
  exactKeys(
    index,
    [
      "schemaVersion",
      "product",
      "version",
      "channel",
      "tag",
      "license",
      "repository",
      "releaseUrl",
      "releaseBuildId",
      "sourceCommit",
      "artifacts",
      "pilotKit",
    ],
    "public_release_index",
  );
  invariant(
    index.schemaVersion === "1.0.0" &&
      index.product === "Sestina Research Room" &&
      index.version === "0.2.0" &&
      index.channel === "public_preview" &&
      index.tag === "v0.2.0" &&
      index.license === "Apache-2.0" &&
      index.repository === "https://github.com/Roblis0n/Sestina" &&
      index.releaseUrl ===
        "https://github.com/Roblis0n/Sestina/releases/tag/v0.2.0" &&
      /^[a-f0-9]{64}$/u.test(index.releaseBuildId) &&
      /^[a-f0-9]{40}$/u.test(index.sourceCommit) &&
      Array.isArray(index.artifacts) &&
      index.artifacts.length === EXPECTED.length,
    "public_release_index_invalid",
  );
  index.artifacts.forEach((artifact, position) => {
    const expected = EXPECTED[position];
    exactKeys(
      artifact,
      [
        "platform",
        "os",
        "architecture",
        "file",
        "manifestFile",
        "sha256",
        "size",
      ],
      "public_release_artifact",
    );
    invariant(
      artifact.platform === expected.key &&
        artifact.os === expected.os &&
        artifact.architecture === expected.architecture &&
        artifact.file === expected.file &&
        artifact.manifestFile === expected.manifestFile &&
        /^[a-f0-9]{64}$/u.test(artifact.sha256) &&
        Number.isSafeInteger(artifact.size) &&
        artifact.size > 0,
      "public_release_artifact_invalid",
    );
  });
  exactKeys(
    index.pilotKit,
    [
      "file",
      "sha256",
      "size",
      "pilotKitVersion",
      "protocolVersion",
      "consentVersion",
    ],
    "public_release_pilot_kit",
  );
  invariant(
    index.pilotKit.file === PILOT_FILE &&
      /^[a-f0-9]{64}$/u.test(index.pilotKit.sha256) &&
      Number.isSafeInteger(index.pilotKit.size) &&
      index.pilotKit.size > 0 &&
      index.pilotKit.pilotKitVersion === "2.0.0" &&
      index.pilotKit.protocolVersion === "2026-08-30" &&
      index.pilotKit.consentVersion === "2026-08-30",
    "public_release_pilot_kit_invalid",
  );
  return index;
}

async function verifyPilotArchive(path, index) {
  const entries = await inspectZip(path);
  const root = "sestina-research-room-0.2.0-pilot-kit";
  invariant(
    entries.every((entry) => entry.path.startsWith(`${root}/`)),
    "public_release_pilot_root_invalid",
  );
  const files = new Map(
    entries.map((entry) => [entry.path.slice(root.length + 1), entry.data]),
  );
  const manifestBytes = files.get("pilot-kit-manifest.json");
  const sumsBytes = files.get("SHA256SUMS");
  invariant(manifestBytes && sumsBytes, "public_release_pilot_manifest_missing");
  const { parsePilotKitManifest } = await import(
    "../../packages/pilot/dist/kit.js"
  );
  const manifest = parsePilotKitManifest(
    JSON.parse(manifestBytes.toString("utf8")),
  );
  invariant(
    manifest.sestinaRelease.buildId === index.releaseBuildId &&
      manifest.sestinaRelease.sourceCommit === index.sourceCommit,
    "public_release_pilot_binding_mismatch",
  );
  const expectedFiles = new Set([
    "pilot-kit-manifest.json",
    "SHA256SUMS",
    ...manifest.files.map((file) => file.path),
  ]);
  invariant(
    files.size === expectedFiles.size &&
      [...files.keys()].every((file) => expectedFiles.has(file)),
    "public_release_pilot_files_invalid",
  );
  const sums = parseChecksums(sumsBytes.toString("utf8"));
  invariant(
    sums.get("pilot-kit-manifest.json") === sha256(manifestBytes),
    "public_release_pilot_manifest_hash_mismatch",
  );
  for (const file of manifest.files) {
    const bytes = files.get(file.path);
    invariant(
      bytes &&
        bytes.length === file.size &&
        sha256(bytes) === file.sha256 &&
        sums.get(file.path) === file.sha256,
      `public_release_pilot_file_mismatch:${file.path}`,
    );
  }
}

export async function verifyPublicReleaseDirectory(directory) {
  const indexBytes = await readFile(join(directory, INDEX_FILE));
  const index = validateIndex(JSON.parse(indexBytes.toString("utf8")));
  const expectedFiles = [
    SUMS_FILE,
    INDEX_FILE,
    PILOT_FILE,
    ...EXPECTED.flatMap((item) => [item.file, item.manifestFile]),
  ].sort((left, right) => left.localeCompare(right, "en"));
  const actualFiles = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));
  invariant(
    JSON.stringify(actualFiles) === JSON.stringify(expectedFiles),
    "public_release_files_invalid",
  );

  const sums = parseChecksums(await readFile(join(directory, SUMS_FILE), "utf8"));
  invariant(
    sums.size === expectedFiles.length - 1 &&
      sums.get(INDEX_FILE) === sha256(indexBytes),
    "public_release_sums_invalid",
  );

  for (let position = 0; position < EXPECTED.length; position += 1) {
    const expected = EXPECTED[position];
    const record = index.artifacts[position];
    const artifactPath = join(directory, expected.file);
    const manifestPath = join(directory, expected.manifestFile);
    const artifactBytes = await readFile(artifactPath);
    const manifestBytes = await readFile(manifestPath);
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    validateReleaseManifest(manifest);
    invariant(
      manifest.platform.os === expected.os &&
        manifest.platform.architecture === expected.architecture &&
        manifest.distribution.platformSlug === expected.slug &&
        manifest.distribution.primaryArtifact === expected.file &&
        manifest.identity.releaseBuildId === index.releaseBuildId &&
        manifest.source.gitCommit === index.sourceCommit &&
        sha256(artifactBytes) === record.sha256 &&
        artifactBytes.length === record.size &&
        sums.get(expected.file) === record.sha256 &&
        sums.get(expected.manifestFile) === sha256(manifestBytes),
      `public_release_platform_mismatch:${expected.key}`,
    );
    const entries = expected.file.endsWith(".zip")
      ? await inspectZip(artifactPath)
      : await inspectTarGzip(artifactPath);
    verifyReleaseBundleEntries(entries, manifest);
  }

  const pilotPath = join(directory, PILOT_FILE);
  const pilotBytes = await readFile(pilotPath);
  invariant(
    (await stat(pilotPath)).isFile() &&
      pilotBytes.length === index.pilotKit.size &&
      sha256(pilotBytes) === index.pilotKit.sha256 &&
      sums.get(PILOT_FILE) === index.pilotKit.sha256,
    "public_release_pilot_hash_mismatch",
  );
  await verifyPilotArchive(pilotPath, index);
  return Object.freeze({
    index,
    verifiedFiles: Object.freeze(expectedFiles),
    directory: basename(directory),
  });
}

export const PUBLIC_RELEASE_LAYOUT = Object.freeze({
  platforms: EXPECTED,
  pilotFile: PILOT_FILE,
  indexFile: INDEX_FILE,
  sumsFile: SUMS_FILE,
});
