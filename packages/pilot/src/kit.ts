import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, posix, relative, resolve } from "node:path";

import {
  PILOT_CONSENT_VERSION,
  PILOT_KIT_MANIFEST_SCHEMA_VERSION,
  PILOT_KIT_VERSION,
  PILOT_PROTOCOL_VERSION,
  expectExactKeys,
} from "./contracts.js";

export interface PilotKitManifestFile {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

export interface PilotKitManifest {
  readonly schemaVersion: typeof PILOT_KIT_MANIFEST_SCHEMA_VERSION;
  readonly pilotKitVersion: typeof PILOT_KIT_VERSION;
  readonly protocolVersion: typeof PILOT_PROTOCOL_VERSION;
  readonly consentVersion: typeof PILOT_CONSENT_VERSION;
  readonly sestinaRelease: {
    readonly version: string;
    readonly buildId: string;
    readonly artifactFile: string;
    readonly artifactSha256: string;
  };
  readonly files: readonly PilotKitManifestFile[];
  readonly security: {
    readonly localOnly: true;
    readonly noTelemetry: true;
    readonly participantControlledExport: true;
    readonly containsResearchContent: false;
    readonly containsCredentials: false;
  };
}

const STATIC_PAYLOAD_PATHS = [
  "README.md",
  "bin/sestina-pilot.mjs",
  "docs/CONSENT.md",
  "docs/EXIT-INTERVIEW.md",
  "docs/OBSERVATION-FORM.md",
  "docs/PROTOCOL.md",
  "docs/RESULTS-TEMPLATE.md",
  "install/install-linux.sh",
  "install/install-macos.sh",
  "install/install-windows.ps1",
  "schema/shareable-pilot-export.schema.json",
  "walkthrough/SYNTHETIC-WALKTHROUGH.md",
] as const;

function fail(code: string): never {
  throw new Error(code);
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    fail("pilot_kit_manifest_invalid");
  }
  return value as number;
}

function safeRelativePath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 240 ||
    value.includes("\\") ||
    value.startsWith("/") ||
    posix.normalize(value) !== value ||
    value.split("/").some((part) => part === ".." || part === "." || part === "") ||
    !/^[A-Za-z0-9._/-]+$/u.test(value)
  ) {
    fail("pilot_kit_manifest_invalid");
  }
  return value;
}

export function parsePilotKitManifest(value: unknown): PilotKitManifest {
  expectExactKeys(
    value,
    [
      "schemaVersion",
      "pilotKitVersion",
      "protocolVersion",
      "consentVersion",
      "sestinaRelease",
      "files",
      "security",
    ],
    "pilot_kit_manifest_invalid",
  );
  if (
    value.schemaVersion !== PILOT_KIT_MANIFEST_SCHEMA_VERSION ||
    value.pilotKitVersion !== PILOT_KIT_VERSION ||
    value.protocolVersion !== PILOT_PROTOCOL_VERSION ||
    value.consentVersion !== PILOT_CONSENT_VERSION ||
    !Array.isArray(value.files)
  ) {
    fail("pilot_kit_manifest_invalid");
  }
  expectExactKeys(
    value.sestinaRelease,
    ["version", "buildId", "artifactFile", "artifactSha256"],
    "pilot_kit_manifest_invalid",
  );
  const release = value.sestinaRelease;
  if (
    typeof release.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(release.version) ||
    typeof release.buildId !== "string" ||
    !/^[a-f0-9]{64}$/u.test(release.buildId) ||
    typeof release.artifactFile !== "string" ||
    release.artifactFile !== `sestina-cli-${release.version}.tgz` ||
    typeof release.artifactSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(release.artifactSha256)
  ) {
    fail("pilot_kit_manifest_invalid");
  }
  const artifactFile = release.artifactFile;
  const artifactSha256 = release.artifactSha256;
  const files = value.files.map((item): PilotKitManifestFile => {
    expectExactKeys(
      item,
      ["path", "sha256", "size"],
      "pilot_kit_manifest_invalid",
    );
    const path = safeRelativePath(item.path);
    if (typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(item.sha256)) {
      fail("pilot_kit_manifest_invalid");
    }
    return {
      path,
      sha256: item.sha256,
      size: integer(item.size, 0, 100_000_000),
    };
  });
  const paths = files.map((file) => file.path);
  const sorted = [...paths].sort((left, right) => left.localeCompare(right, "en"));
  if (
    paths.some((path, index) => path !== sorted[index]) ||
    new Set(paths).size !== paths.length ||
    new Set(paths.map((path) => path.toLowerCase())).size !== paths.length
  ) {
    fail("pilot_kit_manifest_invalid");
  }
  const expected = [
    ...STATIC_PAYLOAD_PATHS,
    `release/${artifactFile}`,
  ].sort((left, right) => left.localeCompare(right, "en"));
  if (
    paths.length !== expected.length ||
    paths.some((path, index) => path !== expected[index])
  ) {
    fail("pilot_kit_manifest_invalid");
  }
  expectExactKeys(
    value.security,
    [
      "localOnly",
      "noTelemetry",
      "participantControlledExport",
      "containsResearchContent",
      "containsCredentials",
    ],
    "pilot_kit_manifest_invalid",
  );
  if (
    value.security.localOnly !== true ||
    value.security.noTelemetry !== true ||
    value.security.participantControlledExport !== true ||
    value.security.containsResearchContent !== false ||
    value.security.containsCredentials !== false
  ) {
    fail("pilot_kit_manifest_invalid");
  }
  const artifact = files.find(
    (file) => file.path === `release/${artifactFile}`,
  );
  if (artifact?.sha256 !== artifactSha256) {
    fail("pilot_kit_manifest_invalid");
  }
  return {
    schemaVersion: PILOT_KIT_MANIFEST_SCHEMA_VERSION,
    pilotKitVersion: PILOT_KIT_VERSION,
    protocolVersion: PILOT_PROTOCOL_VERSION,
    consentVersion: PILOT_CONSENT_VERSION,
    sestinaRelease: {
      version: release.version,
      buildId: release.buildId,
      artifactFile,
      artifactSha256,
    },
    files,
    security: {
      localOnly: true,
      noTelemetry: true,
      participantControlledExport: true,
      containsResearchContent: false,
      containsCredentials: false,
    },
  };
}

async function filesUnder(
  root: string,
  current = root,
  result: string[] = [],
): Promise<string[]> {
  const entries = (await readdir(current, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name, "en"),
  );
  for (const entry of entries) {
    const path = join(current, entry.name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) fail("pilot_kit_unsafe_path");
    if (stat.isDirectory()) await filesUnder(root, path, result);
    else if (stat.isFile()) {
      result.push(relative(root, path).replaceAll("\\", "/"));
    } else fail("pilot_kit_unsafe_path");
  }
  return result;
}

export interface VerifiedPilotKit {
  readonly manifest: PilotKitManifest;
  readonly verifiedFiles: readonly string[];
}

export async function verifyPilotKit(rootInput: string): Promise<VerifiedPilotKit> {
  if (!isAbsolute(rootInput) || rootInput.includes("\0")) {
    fail("pilot_kit_root_invalid");
  }
  const root = resolve(rootInput);
  let rootStat;
  try {
    rootStat = lstatSync(root);
  } catch {
    fail("pilot_kit_root_invalid");
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    fail("pilot_kit_root_invalid");
  }
  const canonical = realpathSync.native(root);
  if (
    (process.platform === "win32" ? canonical.toLowerCase() : canonical) !==
    (process.platform === "win32" ? root.toLowerCase() : root)
  ) {
    fail("pilot_kit_root_invalid");
  }
  const actualPaths = await filesUnder(root);
  if (new Set(actualPaths.map((path) => path.toLowerCase())).size !== actualPaths.length) {
    fail("pilot_kit_case_collision");
  }
  const manifestPath = join(root, "pilot-kit-manifest.json");
  let manifestBytes: Buffer;
  let manifest: PilotKitManifest;
  try {
    manifestBytes = await readFile(manifestPath);
    if (manifestBytes.length > 1_048_576) fail("pilot_kit_manifest_invalid");
    manifest = parsePilotKitManifest(
      JSON.parse(manifestBytes.toString("utf8")) as unknown,
    );
  } catch (error) {
    if (error instanceof Error && error.message === "pilot_kit_manifest_invalid") {
      throw error;
    }
    fail("pilot_kit_manifest_invalid");
  }
  const expectedPaths = [
    ...manifest.files.map((file) => file.path),
    "SHA256SUMS",
    "pilot-kit-manifest.json",
  ].sort((left, right) => left.localeCompare(right, "en"));
  const sortedActual = [...actualPaths].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  const unexpected = sortedActual.filter((path) => !expectedPaths.includes(path));
  if (unexpected.length > 0) fail("pilot_kit_extra_file");
  if (
    sortedActual.length !== expectedPaths.length ||
    expectedPaths.some((path, index) => path !== sortedActual[index])
  ) {
    fail("pilot_kit_missing_file");
  }
  for (const file of manifest.files) {
    const bytes = await readFile(join(root, ...file.path.split("/")));
    if (bytes.length !== file.size || hash(bytes) !== file.sha256) {
      fail("pilot_kit_hash_mismatch");
    }
  }
  const sumsPath = join(root, "SHA256SUMS");
  const sums = (await readFile(sumsPath, "utf8"))
    .split(/\r?\n/u)
    .filter((line) => line.length > 0);
  const expectedSums = [
    ...manifest.files.map((file) => `${file.sha256}  ${file.path}`),
    `${hash(manifestBytes)}  pilot-kit-manifest.json`,
  ].sort((left, right) => {
    const leftPath = left.slice(66);
    const rightPath = right.slice(66);
    return leftPath.localeCompare(rightPath, "en");
  });
  if (
    sums.length !== expectedSums.length ||
    sums.some((line, index) => line !== expectedSums[index])
  ) {
    fail("pilot_kit_sums_invalid");
  }
  return { manifest, verifiedFiles: manifest.files.map((file) => file.path) };
}
