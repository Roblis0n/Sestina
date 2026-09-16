export function assertExecutedTests(report) {
  const cases = report?.testResults?.flatMap(
    (file) => file.assertionResults ?? [],
  );
  if (
    !Number.isSafeInteger(report?.numTotalTests) ||
    report.numTotalTests < 1 ||
    report.numPassedTests !== report.numTotalTests ||
    report.numFailedTests !== 0 ||
    report.numPendingTests !== 0 ||
    (report.numTodoTests ?? 0) !== 0 ||
    !cases ||
    cases.length !== report.numTotalTests ||
    cases.some((item) => item.status !== "passed")
  )
    throw Error("target_tests_incomplete");
  return report.numTotalTests;
}
export function canReuseTargetCheck(record, binding, evidenceSha256) {
  return (
    record?.status === "passed" &&
    record.count > 0 &&
    record.evidenceSha256 === evidenceSha256 &&
    JSON.stringify(record.binding) === JSON.stringify(binding)
  );
}
// Unknown inputs invalidate evidence. These exclusions name validation-only
// changes; artifact, runtime and shared fixture changes remain fail-closed.
export function targetCheckAffected(id, paths) {
  return paths.some((path) => {
    if (
      /^(?:docs\/|README\.md$)/.test(path) ||
      path === "apps/desktop/README.md"
    )
      return false;
    if (
      /^(?:apps\/[^/]+\/test\/|packages\/[^/]+\/test\/|tests\/repository\/).*\.test\.ts$/.test(
        path,
      )
    )
      return id === "public";
    if (path === "tests/post-0.2/process-harness.ts") return id === "public";
    if (path === "tests/post-0.2/discovery.json")
      return id === "public" || id === "foundation";
    if (path === "scripts/lib/installed-resource-metrics.mjs")
      return id === "public" || id === "resources";
    const installed = /^tests\/desktop\/installed-([\w-]+)\.ts$/.exec(path);
    if (installed) return id === installed[1];
    if (/^tests\/desktop\/.*\.test\.ts$/.test(path)) return id === "desktop";
    if (/^tests\/post-0\.2\/(?:foundation|downstream)\//.test(path))
      return id === "public" || id === "foundation";
    if (
      [
        "scripts/run-target-gates.mjs",
        "scripts/run-public-shared-gates.mjs",
        "scripts/lib/target-verification.mjs",
        "scripts/lib/target-verification.d.mts",
        "scripts/run-desktop-platform.mjs",
        "scripts/run-desktop-workflow.mjs",
        "scripts/lib/desktop-readiness.mjs",
        ".github/workflows/release.yml",
      ].includes(path)
    )
      return id === "public";
    const checker = {
      "scripts/verify-desktop-artifact.mjs": "artifact",
      "scripts/verify-target-cutover.mjs": "cutover",
      "scripts/verify-desktop-core-reproducibility.mjs": "reproducibility",
    }[path];
    if (checker) return id === checker;
    return true;
  });
}
export function assertTargetTagIdentity(
  tag,
  version,
  resolvedCommit,
  sourceCommit,
) {
  if (tag !== `v${version}`) throw Error("publication_tag_version_mismatch");
  if (!/^[a-f0-9]{40}$/.test(resolvedCommit) || resolvedCommit !== sourceCommit)
    throw Error("publication_tag_source_mismatch");
}

export const desktopTargets = ["win32-x64", "darwin-arm64", "linux-x64"];
export const desktopEvidenceOptions = [
  "lifecycle-result",
  "reinstall-result",
  "visual-observation",
  "readiness",
  "shared-public",
];
export function desktopEvidenceArguments(values) {
  return desktopEvidenceOptions.flatMap((key) =>
    values[key] ? [`--${key}`, values[key]] : [],
  );
}
export function assertEvidenceIdentity(record, binding) {
  for (const key of ["sourceCommit", "installerSha256", "platform", "arch"])
    if (record?.[key] !== binding[key])
      throw Error("execution_identity_mismatch");
}
function assertCases(record, binding, required) {
  assertEvidenceIdentity(record, binding);
  if (
    record.passed !== true ||
    (record.skipped ?? 0) !== 0 ||
    (record.todo ?? 0) !== 0 ||
    !Array.isArray(record.cases)
  )
    throw Error("execution_incomplete");
  const ids = record.cases.map((item) => {
    if (typeof item === "string" && item) return item;
    if (item?.status === "passed" && typeof item.id === "string" && item.id)
      return item.id;
    throw Error("execution_case_not_passed");
  });
  if (
    new Set(ids).size !== ids.length ||
    !required.every((id) => ids.includes(id))
  )
    throw Error("execution_required_cases_missing");
  return ids.length;
}
export function assertLifecycleResult(record, binding) {
  const required =
    binding.platform === "win32"
      ? [
          "pre-upgrade-sqlite-backup",
          "backup-failure-blocks-installer",
          "verified-candidate-silent-upgrade",
          "restart-no-update-request",
          "preserved-old-program-actually-opened",
        ]
      : [
          "actual-install",
          "native-credential-backend",
          "upgrade-and-pre-upgrade-backup",
          "preserved-program-recovery",
          "uninstall-reinstall",
        ];
  if (
    binding.platform === "win32" &&
    !record?.cases?.some((item) =>
      [
        "actual-initial-silent-install",
        "verified-previous-isolated-install-copy",
      ].includes(typeof item === "string" ? item : item?.id),
    )
  )
    throw Error("execution_initial_install_missing");
  return assertCases(record, binding, required);
}
export function assertReinstallResult(record, binding) {
  const operation = {
    win32: "current-package-actual-silent-uninstall",
    darwin: "current-package-app-bundle-removal",
    linux: "current-package-appimage-removal",
  }[binding.platform];
  if (!operation) throw Error("unsupported_execution_platform");
  return assertCases(record, binding, [
    operation,
    "project-brief-preserved-and-reopened",
    "settings-and-encrypted-credential-preserved",
    "actual-reinstall-same-package",
  ]);
}
export function assertReadinessBinding(input, binding) {
  if (
    input?.sourceCommit !== binding.sourceCommit ||
    input?.artifacts?.[`${binding.platform}-${binding.arch}`]?.sha256 !==
      binding.installerSha256
  )
    throw Error("readiness_active_artifact_mismatch");
}
export function aggregateTargetResults(results) {
  if (!results.length) throw Error("platform_results_missing");
  const sourceCommit = results[0].sourceCommit;
  if (!/^[a-f0-9]{40}$/.test(sourceCommit))
    throw Error("platform_source_invalid");
  const platforms = {},
    remaining = [];
  for (const result of results) {
    if (result.sourceCommit !== sourceCommit)
      throw Error("platform_source_mismatch");
    const target = `${result.environment?.platform}-${result.environment?.arch}`;
    if (!desktopTargets.includes(target))
      throw Error("platform_target_invalid");
    if (platforms[target]) throw Error("duplicate_platform_result");
    const required = [
      "public",
      "artifact",
      "desktop",
      "reproducibility",
      "journeys",
      "performance",
      "resources",
      "visual",
      "lifecycle",
      "reinstall",
      "cutover",
    ];
    const executed =
      result.phase === "final" &&
      required.every(
        (id) =>
          result.checks?.[id]?.status === "passed" &&
          Number.isSafeInteger(result.checks[id].count) &&
          result.checks[id].count > 0,
      );
    const actual = {
      ...result,
      localPassed: result.localPassed === true && executed,
    };
    if (
      actual.platformAcceptance === "passed" &&
      (!actual.localPassed ||
        actual.readiness?.sourceCommit !== sourceCommit ||
        !Array.isArray(actual.readiness?.errors) ||
        actual.readiness.errors.length ||
        !Array.isArray(actual.readiness?.checks) ||
        [
          ...remainingDesktopRequirements
            .filter((item) => item.target === target)
            .map((item) => item.id),
          `${target}.installer-bytes`,
        ].some(
          (id) =>
            actual.readiness.checks.filter(
              (check) => check.id === id && check.status === "passed",
            ).length !== 1,
        ) ||
        !actual.observation?.sha256 ||
        !/^[a-f0-9]{64}$/.test(actual.installerSha256))
    )
      throw Error("platform_formal_evidence_incomplete");
    if (
      result.version !== results[0].version ||
      result.schemaVersion !== results[0].schemaVersion ||
      result.migrationSourceSha256 !== results[0].migrationSourceSha256
    )
      throw Error("platform_release_identity_mismatch");
    platforms[target] = actual;
    remaining.push(
      ...(result.remaining ?? [])
        .filter(
          (item) =>
            !desktopTargets.some(
              (other) => other !== target && item.id.startsWith(`${other}.`),
            ),
        )
        .map((item) => ({ ...item, target })),
    );
    if (!actual.localPassed)
      remaining.push({
        id: `${target}.execution`,
        status: "failed",
        reason: result.error ?? "local_checks_incomplete",
      });
    if (result.platformAcceptance !== "passed")
      remaining.push({
        id: `${target}.formal-acceptance`,
        status: "not_established",
      });
  }
  for (const target of desktopTargets)
    if (!platforms[target])
      remaining.push({
        id: `${target}.execution`,
        status: "not_established",
        reason: "native_result_missing",
      });
  const localPassed = Object.values(platforms).every(
    (result) => result.localPassed === true,
  );
  return {
    schema: 1,
    sourceCommit,
    platforms,
    localPassed,
    formalAcceptance:
      localPassed && remaining.length === 0 ? "passed" : "not_established",
    published: false,
    remaining,
  };
}
import { join, basename, dirname, resolve } from "node:path";
import { readFile, writeFile, mkdir, copyFile, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { createPublicKey, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  fileSha256,
  remainingDesktopRequirements,
} from "./desktop-readiness.mjs";

const safeAsset = (name) =>
  typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(name);
const readJsonFile = async (path) => {
  const info = await lstat(path);
  if (!info.isFile() || info.size > 8 * 1024 * 1024)
    throw Error("release_record_invalid");
  return JSON.parse(await readFile(path, "utf8"));
};
function checksumEntries(text) {
  const result = new Map();
  for (const line of text.trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match || !safeAsset(match[2]) || result.has(match[2]))
      throw Error("release_checksums_invalid");
    result.set(match[2], match[1]);
  }
  return result;
}
function assertReleaseIdentity(manifest, identity) {
  for (const key of [
    "sourceCommit",
    "version",
    "publicTag",
    "sourceTree",
    "lockSha256",
    "schema",
    "migrationSourceSha256",
    "sequence",
    "profile",
    "channel",
  ])
    if (identity[key] !== undefined && manifest[key] !== identity[key])
      throw Error(`release_identity_mismatch:${key}`);
  if (
    manifest.profile !== "release" ||
    manifest.channel !== "stable" ||
    manifest.publicTag !== `v${manifest.version}` ||
    !/^[a-f0-9]{40}$/.test(manifest.sourceCommit) ||
    !/^[a-f0-9]{40}$/.test(manifest.sourceTree) ||
    !/^[a-f0-9]{64}$/.test(manifest.lockSha256) ||
    !/^[a-f0-9]{64}$/.test(manifest.migrationSourceSha256) ||
    manifest.schema !== 25
  )
    throw Error("production_release_identity_required");
  const status = {
    win32: "authenticode_verified",
    darwin: "signed_notarized_verified",
    linux: "checksum_provenance",
  }[manifest.platform];
  if (
    !status ||
    manifest.envelope?.status !== status ||
    !desktopTargets.includes(`${manifest.platform}-${manifest.arch}`)
  )
    throw Error("verified_release_envelope_required");
}
function assertUpdateOffer(offer, manifest, installer) {
  const root = manifest.update?.roots?.[offer?.keyId];
  if (
    typeof offer?.payload !== "string" ||
    typeof offer.signature !== "string" ||
    !root ||
    !root.startsWith("-----BEGIN PUBLIC KEY-----")
  )
    throw Error("release_update_signature_missing");
  const key = createPublicKey(root);
  if (
    key.asymmetricKeyType !== "ed25519" ||
    !verify(
      null,
      Buffer.from(offer.payload),
      key,
      Buffer.from(offer.signature, "base64"),
    )
  )
    throw Error("release_update_signature_invalid");
  const payload = JSON.parse(offer.payload);
  for (const field of [
    "sourceCommit",
    "version",
    "channel",
    "sequence",
    "platform",
    "arch",
    "schema",
    "migrationSourceSha256",
    "unsignedCoreSha256",
  ])
    if (payload[field] !== manifest[field])
      throw Error(`release_update_identity_mismatch:${field}`);
  const extension = { win32: "exe", darwin: "dmg", linux: "AppImage" }[
    manifest.platform
  ];
  if (
    payload.format !== "2.0.0" ||
    payload.signed !== true ||
    payload.sha256 !== installer.sha256 ||
    payload.size !== installer.size ||
    payload.artifactPath !==
      `/artifacts/${installer.sha256}/Sestina.${extension}`
  )
    throw Error("release_update_installer_mismatch");
  const endpoint = new URL(manifest.update.source);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw Error("release_update_source_invalid");
}

// Assemble reviewable release bytes through the existing target verification
// entry. This neither signs nor uploads, and never renames a candidate as stable.
export async function assembleTargetRelease(packages, output) {
  if (
    !Array.isArray(packages) ||
    packages.length !== 3 ||
    new Set(packages.map((p) => p.target)).size !== 3 ||
    packages.some((p) => !desktopTargets.includes(p.target))
  )
    throw Error("release_three_targets_required");
  await mkdir(output, { recursive: false });
  let identity;
  const assets = [],
    targets = [];
  for (const item of packages) {
    const manifest = await readJsonFile(item.manifest);
    identity ??= Object.fromEntries(
      [
        "sourceCommit",
        "version",
        "publicTag",
        "sourceTree",
        "lockSha256",
        "schema",
        "migrationSourceSha256",
        "channel",
        "profile",
        "sequence",
      ].map((key) => [key, manifest[key]]),
    );
    assertReleaseIdentity(manifest, identity);
    if (`${manifest.platform}-${manifest.arch}` !== item.target)
      throw Error("release_target_mismatch");
    const name = basename(item.installer),
      sha256 = fileSha256(item.installer),
      size = (await lstat(item.installer)).size;
    const installer = { name, sha256, size };
    if (
      !safeAsset(name) ||
      !manifest.envelope.files.some(
        (file) =>
          file.name === name && file.sha256 === sha256 && file.size === size,
      )
    )
      throw Error("release_installer_binding_mismatch");
    const original = checksumEntries(
      await readFile(join(dirname(item.manifest), "SHA256SUMS"), "utf8"),
    );
    for (const [file, expected] of original)
      if (fileSha256(join(dirname(item.manifest), file)) !== expected)
        throw Error("release_original_checksum_mismatch");
    for (const file of [name, basename(item.manifest), "unsigned-core.tar.gz"])
      if (!original.has(file)) throw Error("release_original_checksum_missing");
    if (
      fileSha256(join(dirname(item.manifest), "unsigned-core.tar.gz")) !==
      manifest.unsignedCoreSha256
    )
      throw Error("release_core_mismatch");
    assertUpdateOffer(await readJsonFile(item.update), manifest, installer);
    const selected = [
      { role: "installer", name, path: item.installer },
      {
        role: "manifest",
        name: `${item.target}-manifest.json`,
        path: item.manifest,
      },
      {
        role: "core",
        name: `${item.target}-unsigned-core.tar.gz`,
        path: join(dirname(item.manifest), "unsigned-core.tar.gz"),
      },
      {
        role: "checksums",
        name: `${item.target}-SHA256SUMS`,
        path: join(dirname(item.manifest), "SHA256SUMS"),
      },
      { role: "update", name: `${item.target}-update.json`, path: item.update },
      ...[...original.keys()]
        .filter((file) => file.endsWith(".blockmap"))
        .map((file) => ({
          role: "blockmap",
          name: file,
          path: join(dirname(item.manifest), file),
        })),
    ];
    for (const file of selected) {
      if (
        !safeAsset(file.name) ||
        assets.some((asset) => asset.name === file.name)
      )
        throw Error("release_duplicate_asset");
      await copyFile(
        file.path,
        join(output, file.name),
        constants.COPYFILE_EXCL,
      );
      assets.push({
        target: item.target,
        role: file.role,
        name: file.name,
        sha256: fileSha256(join(output, file.name)),
        size: (await lstat(join(output, file.name))).size,
      });
    }
    targets.push(item.target);
  }
  const index = { format: 1, ...identity, targets, assets };
  await writeFile(
    join(output, "release-index.json"),
    JSON.stringify(index, null, 2) + "\n",
    { flag: "wx" },
  );
  await writeFile(
    join(output, "SHA256SUMS"),
    [
      ...assets.map((asset) => `${asset.sha256}  ${asset.name}`),
      `${fileSha256(join(output, "release-index.json"))}  release-index.json`,
    ].join("\n") + "\n",
    { flag: "wx" },
  );
  await inspectTargetRelease(output, identity);
  return index;
}
export async function inspectTargetRelease(directory, identity) {
  const index = await readJsonFile(join(directory, "release-index.json"));
  if (
    index.format !== 1 ||
    !Array.isArray(index.targets) ||
    index.targets.length !== 3 ||
    desktopTargets.some((target) => !index.targets.includes(target)) ||
    !Array.isArray(index.assets)
  )
    throw Error("release_index_invalid");
  for (const [key, value] of Object.entries(identity))
    if (index[key] !== value)
      throw Error(`release_index_identity_mismatch:${key}`);
  const checksums = checksumEntries(
    await readFile(join(directory, "SHA256SUMS"), "utf8"),
  );
  if (
    new Set(index.assets.map((asset) => asset.name)).size !==
      index.assets.length ||
    checksums.size !== index.assets.length + 1 ||
    checksums.get("release-index.json") !==
      fileSha256(join(directory, "release-index.json"))
  )
    throw Error("release_index_checksum_mismatch");
  for (const asset of index.assets) {
    if (
      !safeAsset(asset.name) ||
      !desktopTargets.includes(asset.target) ||
      ![
        "installer",
        "manifest",
        "core",
        "checksums",
        "update",
        "blockmap",
      ].includes(asset.role)
    )
      throw Error("release_asset_invalid");
    const path = join(directory, asset.name),
      info = await lstat(path);
    if (
      !info.isFile() ||
      info.size !== asset.size ||
      fileSha256(path) !== asset.sha256 ||
      checksums.get(asset.name) !== asset.sha256
    )
      throw Error("release_asset_bytes_mismatch");
  }
  for (const target of desktopTargets) {
    const byRole = (role) => {
      const entries = index.assets.filter(
        (asset) => asset.target === target && asset.role === role,
      );
      if (entries.length !== 1)
        throw Error(`release_required_asset_missing:${target}:${role}`);
      return entries[0];
    };
    const installer = byRole("installer"),
      manifestAsset = byRole("manifest"),
      core = byRole("core");
    const manifest = await readJsonFile(join(directory, manifestAsset.name));
    assertReleaseIdentity(manifest, index);
    if (
      `${manifest.platform}-${manifest.arch}` !== target ||
      manifest.unsignedCoreSha256 !== core.sha256 ||
      !manifest.envelope.files.some(
        (file) =>
          file.name === installer.name &&
          file.sha256 === installer.sha256 &&
          file.size === installer.size,
      )
    )
      throw Error("release_manifest_bytes_mismatch");
    const original = checksumEntries(
      await readFile(join(directory, byRole("checksums").name), "utf8"),
    );
    const originalAssets = new Map([
      ["candidate-manifest.json", manifestAsset],
      ["unsigned-core.tar.gz", core],
      [installer.name, installer],
      ...index.assets
        .filter((asset) => asset.target === target && asset.role === "blockmap")
        .map((asset) => [asset.name, asset]),
    ]);
    if (
      original.size !== originalAssets.size ||
      [...originalAssets].some(
        ([name, asset]) => original.get(name) !== asset.sha256,
      )
    )
      throw Error("release_platform_checksum_mismatch");
    assertUpdateOffer(
      await readJsonFile(join(directory, byRole("update").name)),
      manifest,
      installer,
    );
  }
  return index;
}
export async function verifyPublishedTargetRelease({
  directory,
  repository,
  identity,
  output,
  runGh = (args) =>
    execFileSync("gh", args, {
      encoding: "utf8",
      windowsHide: true,
      stdio: "pipe",
    }),
}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw Error("publication_repository_invalid");
  const expected = await inspectTargetRelease(directory, identity);
  const release = JSON.parse(
    runGh([
      "release",
      "view",
      identity.publicTag,
      "--repo",
      repository,
      "--json",
      "tagName,isDraft,assets",
    ]),
  );
  if (release.isDraft || release.tagName !== identity.publicTag)
    throw Error("publication_release_not_public");
  const commit = JSON.parse(
    runGh(["api", `repos/${repository}/commits/${identity.publicTag}`]),
  );
  if (commit.sha !== identity.sourceCommit)
    throw Error("publication_remote_tag_mismatch");
  const names = [
    ...expected.assets.map((asset) => asset.name),
    "release-index.json",
    "SHA256SUMS",
  ];
  for (const name of names) {
    const assets = release.assets.filter((asset) => asset.name === name);
    if (assets.length !== 1)
      throw Error(`publication_attachment_missing:${name}`);
    if (
      assets[0].digest &&
      assets[0].digest !== `sha256:${fileSha256(join(directory, name))}`
    )
      throw Error("publication_attachment_mismatch");
  }
  await mkdir(output, { recursive: false });
  runGh([
    "release",
    "download",
    identity.publicTag,
    "--repo",
    repository,
    "--dir",
    output,
    ...names.flatMap((name) => ["--pattern", name]),
  ]);
  for (const name of names)
    if (fileSha256(join(output, name)) !== fileSha256(join(directory, name)))
      throw Error("publication_download_bytes_mismatch");
  await inspectTargetRelease(output, identity);
  return {
    passed: true,
    sourceCommit: identity.sourceCommit,
    repository,
    tag: identity.publicTag,
    directory: output,
    assets: names.map((name) => ({
      name,
      sha256: fileSha256(join(output, name)),
    })),
    installationAcceptance: "separate_native_downloaded_installation_required",
  };
}

export async function assertPublishedInstallations(records, index, repository) {
  if (records.length !== 3)
    throw Error("published_native_installations_required");
  const seen = new Set();
  for (const { path, result } of records) {
    const target = `${result.platform}-${result.arch}`;
    const installer = index.assets.find(
      (asset) => asset.target === target && asset.role === "installer",
    );
    if (
      !installer ||
      seen.has(target) ||
      result.repository !== repository ||
      result.tag !== index.publicTag ||
      result.origin !== "github_release_download" ||
      !result.installed
    )
      throw Error("published_installation_identity_mismatch");
    assertCases(
      result,
      {
        sourceCommit: index.sourceCommit,
        installerSha256: installer.sha256,
        platform: result.platform,
        arch: result.arch,
      },
      [
        "downloaded-package-installed",
        "installed-artifact-verified",
        "project-open-quit-reopen",
      ],
    );
    if (!Array.isArray(result.evidence) || !result.evidence.length)
      throw Error("published_installation_evidence_missing");
    for (const file of result.evidence)
      if (fileSha256(resolve(dirname(path), file.path)) !== file.sha256)
        throw Error("published_installation_evidence_changed");
    const evidencePath = (role) => {
      const files = result.evidence.filter((file) => file.role === role);
      if (files.length !== 1)
        throw Error("published_installation_proof_missing");
      return resolve(dirname(path), files[0].path);
    };
    const download = await readJsonFile(evidencePath("download"));
    const installation = await readJsonFile(evidencePath("installation"));
    const journeys = await readJsonFile(evidencePath("journeys"));
    const artifact = JSON.parse(
      (await readFile(evidencePath("artifact"), "utf8"))
        .trim()
        .split(/\r?\n/)
        .at(-1),
    );
    assertEvidenceIdentity(installation, result);
    if (
      download.passed !== true ||
      download.repository !== repository ||
      download.tag !== index.publicTag ||
      download.sourceCommit !== index.sourceCommit ||
      !download.assets?.some(
        (file) =>
          file.name === installer.name && file.sha256 === installer.sha256,
      ) ||
      installation.installed !== result.installed ||
      installation.kind === "existing_installation_reverified" ||
      artifact.passed !== true ||
      artifact.installedDirectory !== result.installed ||
      artifact.identity?.sourceCommit !== index.sourceCommit ||
      journeys.passed !== true ||
      journeys.identity?.sourceCommit !== index.sourceCommit ||
      !journeys.cases?.includes("offline-decision-restart-views")
    )
      throw Error("published_installation_proof_mismatch");
    seen.add(target);
  }
}
export function desktopResources(directory, platform) {
  return join(
    directory,
    platform === "darwin" ? "Contents/Resources" : "resources",
  );
}
export function assertDesktopBinary(bytes, platform, arch) {
  let valid = false;
  if (
    bytes.length >= 64 &&
    platform === "win32" &&
    arch === "x64" &&
    bytes.toString("ascii", 0, 2) === "MZ"
  ) {
    const pe = bytes.readUInt32LE(0x3c);
    valid =
      pe + 6 <= bytes.length &&
      bytes.readUInt32LE(pe) === 0x4550 &&
      bytes.readUInt16LE(pe + 4) === 0x8664;
  } else if (bytes.length >= 20 && platform === "linux" && arch === "x64") {
    valid =
      bytes
        .subarray(0, 6)
        .equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1])) &&
      bytes.readUInt16LE(18) === 62;
  } else if (bytes.length >= 32 && platform === "darwin" && arch === "arm64") {
    valid =
      bytes.readUInt32LE(0) === 0xfeedfacf &&
      bytes.readUInt32LE(4) === 0x100000c;
  }
  if (!valid) throw Error("desktop_binary_target_mismatch");
}

export function targetRuntimeChanged(paths) {
  return paths.some(
    (path) =>
      path !== "apps/desktop/README.md" &&
      ((/^(?:apps|packages|integrations)\//.test(path) &&
        !/^(?:apps|packages)\/[^/]+\/test\//.test(path)) ||
        /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json|docs\/release\/THIRD-PARTY-NOTICES\.md|scripts\/(?:build-desktop\.mjs|package-desktop\.mjs|lib\/desktop-(?:distribution|signing)\.mjs))/.test(
          path,
        )),
  );
}
