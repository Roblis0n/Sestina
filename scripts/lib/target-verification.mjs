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
    if (/^(?:docs\/|README\.md$)/.test(path)) return false;
    if (
      /^(?:apps\/[^/]+\/test\/|packages\/[^/]+\/test\/|tests\/repository\/).*\.test\.ts$/.test(
        path,
      )
    )
      return id === "public";
    if (path === "tests/post-0.2/process-harness.ts") return id === "public";
    if (path === "tests/post-0.2/discovery.json")
      return id === "public" || id === "foundation";
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
import { join } from "node:path";
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
