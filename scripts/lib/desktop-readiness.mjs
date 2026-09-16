import { createHash } from "node:crypto";
import {
  closeSync,
  fstatSync,
  openSync,
  readSync,
  readFileSync,
} from "node:fs";
import { resolve } from "node:path";

// Only the outstanding G10/G11 acceptance. This is not the G12 production
// matrix, a signature verifier, or permission to cut over or publish.
export const remainingDesktopRequirements = [
  ...["win32-x64", "darwin-arm64", "linux-x64"].flatMap((target) => [
    {
      id: `${target}.native-focus`,
      target,
      cases: [
        "directory-picker-keyboard",
        "confirmation-keyboard",
        "credential-dialog-keyboard",
        "escape-and-focus-return",
      ],
    },
    {
      id: `${target}.continuous-motion`,
      target,
      cases: ["continuous-transition-observed", "reduced-motion-observed"],
    },
    {
      id: `${target}.native-uninstall`,
      target,
      cases: [
        target === "win32-x64"
          ? "wizard-observed"
          : "platform-uninstall-observed",
        "keyboard-focus",
        "retained-project-reopens",
        "settings-and-credentials-independent",
      ],
    },
    {
      id: `${target}.whole-startup-network`,
      target,
      cases: [
        "recorder-started-before-application",
        "main-and-child-process-attribution",
        "first-and-repeat-start",
        "local-project-research-search-memory",
        "migration-backup-restore-export",
        "explicit-provider-cancel-failure-restart",
        "explicit-update-check-download",
        "system-certificate-traffic-separated",
      ],
    },
    {
      id: `${target}.assistive-technology`,
      target,
      cases: [
        "actual-screen-reader",
        "research-flow-keyboard-read-order",
        "dialog-name-focus-return",
        "200-percent-text",
      ],
    },
    {
      id: `${target}.production-trust`,
      target,
      cases: [
        target === "linux-x64"
          ? "package-checksum-provenance-and-format-signing-policy"
          : "native-signature",
        "production-update-root",
        "signed-upgrade-and-recovery",
        ...(target === "darwin-arm64" ? ["notarization-and-gatekeeper"] : []),
      ],
    },
  ]),
  ...["darwin-arm64", "linux-x64"].map((target) => ({
    id: `${target}.native-lifecycle`,
    target,
    cases: [
      "actual-install",
      "native-credential-backend",
      "upgrade-and-pre-upgrade-backup",
      "preserved-program-recovery",
      "uninstall-reinstall",
      "start-quit-reopen-single-instance-project-lease",
      "credential-backend-unavailable",
      "migration-data-recovery",
      "changed-installation-chinese-and-space-paths",
      "bundled-node-read-only-mcp-skills",
    ],
  })),
];

const digestPattern = /^[a-f0-9]{64}$/;
export function fileSha256(path) {
  const fd = openSync(path, "r");
  try {
    if (!fstatSync(fd).isFile()) throw new Error("not_a_file");
    const buffer = Buffer.alloc(1024 * 1024);
    const digest = createHash("sha256");
    let size;
    while ((size = readSync(fd, buffer, 0, buffer.length, null)) > 0)
      digest.update(buffer.subarray(0, size));
    return digest.digest("hex");
  } finally {
    closeSync(fd);
  }
}

function boundFile(binding, baseDirectory) {
  if (
    !binding ||
    typeof binding.path !== "string" ||
    !binding.path ||
    !digestPattern.test(binding.sha256)
  )
    throw new Error("file_binding_missing");
  const path = resolve(baseDirectory, binding.path);
  if (fileSha256(path) !== binding.sha256)
    throw new Error("file_digest_mismatch");
  return path;
}

export function inspectDesktopReadiness(input, baseDirectory = process.cwd()) {
  const errors = [];
  const checks = [];
  const validInput =
    input?.schema === 1 &&
    /^[a-f0-9]{40}$/.test(input.sourceCommit) &&
    input.artifacts &&
    Array.isArray(input.observations);
  if (!validInput) errors.push("invalid_inventory");
  const observations = validInput ? input.observations : [];
  const known = new Set(remainingDesktopRequirements.map(({ id }) => id));
  const seen = new Set();
  for (const record of observations) {
    if (
      !record ||
      !known.has(record.requirement) ||
      seen.has(record.requirement)
    )
      errors.push("unknown_or_duplicate_observation");
    seen.add(record?.requirement);
  }
  const artifacts = {};
  for (const target of new Set(
    remainingDesktopRequirements.map(({ target }) => target),
  )) {
    try {
      boundFile(input?.artifacts?.[target], baseDirectory);
      artifacts[target] = input.artifacts[target].sha256;
      checks.push({ id: `${target}.installer-bytes`, status: "passed" });
    } catch (error) {
      checks.push({
        id: `${target}.installer-bytes`,
        status: "not_established",
        reason: error.code ?? error.message,
      });
    }
  }
  for (const requirement of remainingDesktopRequirements) {
    try {
      const record = observations.find(
        (item) => item?.requirement === requirement.id,
      );
      if (!record) throw new Error("observation_missing");
      const path = boundFile(record, baseDirectory);
      const bytes = readFileSync(path);
      if (bytes.length > 1024 * 1024) throw new Error("observation_oversized");
      const observed = JSON.parse(bytes.toString("utf8"));
      if (
        observed.schema !== 1 ||
        observed.requirement !== requirement.id ||
        observed.target !== requirement.target ||
        observed.sourceCommit !== input.sourceCommit ||
        !artifacts[requirement.target] ||
        observed.installerSha256 !== artifacts[requirement.target]
      )
        throw new Error("observation_identity_mismatch");
      if (
        observed.status !== "passed" ||
        observed.skipped !== 0 ||
        observed.todo !== 0 ||
        typeof observed.environment !== "string" ||
        !observed.environment.trim()
      )
        throw new Error("observation_incomplete");
      const cases = observed.cases;
      if (
        !Array.isArray(cases) ||
        cases.length === 0 ||
        new Set(cases.map((item) => item?.id)).size !== cases.length ||
        cases.some(
          (item) =>
            !item || typeof item.id !== "string" || item.status !== "passed",
        ) ||
        requirement.cases.some((id) => !cases.some((item) => item.id === id))
      )
        throw new Error("required_cases_not_passed");
      if (!Array.isArray(observed.evidence) || observed.evidence.length === 0)
        throw new Error("raw_evidence_missing");
      for (const evidence of observed.evidence)
        boundFile(evidence, baseDirectory);
      checks.push({
        id: requirement.id,
        status: "passed",
        observationSha256: record.sha256,
      });
    } catch (error) {
      checks.push({
        id: requirement.id,
        status: "not_established",
        reason: error.code ?? error.message,
      });
    }
  }
  return {
    schema: 1,
    scope: "remaining_g10_g11_evidence_only",
    sourceCommit: validInput ? input.sourceCommit : null,
    remainingPrerequisitesSatisfied:
      errors.length === 0 && checks.every((check) => check.status === "passed"),
    g12Acceptance: "not_executed",
    g13Cutover: "not_executed",
    errors,
    checks,
  };
}
