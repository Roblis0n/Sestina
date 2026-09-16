import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { expect, it } from "vitest";
import {
  desktopEvidenceArguments,
  assertLifecycleResult,
  assertReinstallResult,
  assertReadinessBinding,
  aggregateTargetResults,
  targetRuntimeChanged,
} from "../../scripts/lib/target-verification.mjs";

// Synthetic contracts only; these records never supply platform acceptance.
const binding = {
  sourceCommit: "a".repeat(40),
  installerSha256: "b".repeat(64),
  platform: "linux",
  arch: "x64",
};
it("desktop operating documentation does not invalidate identical installed runtime bytes", () => {
  expect(
    targetRuntimeChanged([
      "apps/desktop/README.md",
      "scripts/run-desktop-platform.mjs",
    ]),
  ).toBe(false);
  expect(targetRuntimeChanged(["apps/desktop/src/main.ts"])).toBe(true);
  expect(targetRuntimeChanged(["scripts/package-desktop.mjs"])).toBe(true);
});
it("passes every supplied observation through both desktop entry layers", () => {
  const input = Object.fromEntries(
    [
      "lifecycle-result",
      "reinstall-result",
      "visual-observation",
      "readiness",
      "shared-public",
    ].map((key) => [key, `${key}.json`]),
  );
  expect(desktopEvidenceArguments(input)).toEqual(
    Object.entries(input).flatMap(([key, value]) => [`--${key}`, value]),
  );
});
it("cannot accept arbitrary or partially executed lifecycle cases", () => {
  expect(() =>
    assertLifecycleResult(
      { ...binding, passed: true, cases: ["anything"] },
      binding,
    ),
  ).toThrow();
  const cases = [
    "actual-install",
    "native-credential-backend",
    "upgrade-and-pre-upgrade-backup",
    "preserved-program-recovery",
    "uninstall-reinstall",
  ];
  expect(() =>
    assertLifecycleResult({ ...binding, passed: true, cases }, binding),
  ).not.toThrow();
  for (const extra of [
    { arch: "arm64" },
    { skipped: 1 },
    { todo: 1 },
    { cases: cases.slice(1) },
    { cases: [...cases, { id: "failed", status: "failed" }] },
  ])
    expect(() =>
      assertLifecycleResult(
        { ...binding, passed: true, cases, ...extra },
        binding,
      ),
    ).toThrow();
});
it("requires OS-specific uninstall execution instead of accepting Windows silent evidence on Linux", () => {
  const common = [
    "project-brief-preserved-and-reopened",
    "settings-and-encrypted-credential-preserved",
    "actual-reinstall-same-package",
  ];
  expect(() =>
    assertReinstallResult(
      {
        ...binding,
        passed: true,
        cases: ["current-package-actual-silent-uninstall", ...common],
      },
      binding,
    ),
  ).toThrow();
  expect(() =>
    assertReinstallResult(
      {
        ...binding,
        passed: true,
        cases: ["current-package-appimage-removal", ...common],
      },
      binding,
    ),
  ).not.toThrow();
});
it("binds readiness to the active package before any observation can close a requirement", () => {
  const input = {
    sourceCommit: binding.sourceCommit,
    artifacts: { "linux-x64": { sha256: binding.installerSha256 } },
  };
  expect(() => {
    assertReadinessBinding(input, binding);
  }).not.toThrow();
  expect(() => {
    assertReadinessBinding({ ...input, sourceCommit: "c".repeat(40) }, binding);
  }).toThrow();
  expect(() => {
    assertReadinessBinding(input, {
      ...binding,
      installerSha256: "d".repeat(64),
    });
  }).toThrow();
});
it("merges only distinct native targets from one source and keeps missing platforms explicit", () => {
  const result = {
    ...binding,
    environment: { platform: "linux", arch: "x64" },
    phase: "final",
    localPassed: true,
    platformAcceptance: "not_established",
    checks: { artifact: { status: "passed", count: 1 } },
    remaining: [{ id: "linux-x64.native-focus", status: "not_established" }],
  };
  const combined = aggregateTargetResults([result]);
  expect(combined.formalAcceptance).toBe("not_established");
  expect(
    combined.remaining.some((item) => item.id === "darwin-arm64.execution"),
  ).toBe(true);
  expect(() => aggregateTargetResults([result, result])).toThrow(
    "duplicate_platform_result",
  );
  expect(() =>
    aggregateTargetResults([
      result,
      {
        ...result,
        sourceCommit: "c".repeat(40),
        environment: { platform: "win32", arch: "x64" },
      },
    ]),
  ).toThrow("platform_source_mismatch");
  expect(combined.localPassed).toBe(false);
  expect(() =>
    aggregateTargetResults([
      {
        ...result,
        platformAcceptance: "passed",
        readiness: { checks: [], errors: [] },
      },
    ]),
  ).toThrow("platform_formal_evidence_incomplete");
  expect(() =>
    aggregateTargetResults([
      result,
      {
        ...result,
        version: "different",
        environment: { platform: "win32", arch: "x64" },
      },
    ]),
  ).toThrow("platform_release_identity_mismatch");
});

it("real platform entry preserves an early package failure without reporting acceptance", () => {
  mkdirSync(resolve(".tmp"), { recursive: true });
  const area = mkdtempSync(resolve(".tmp/desktop-entry-contract-"));
  try {
    expect(() =>
      execFileSync(
        process.execPath,
        [
          "scripts/run-desktop-platform.mjs",
          "--output",
          area,
          "--manifest",
          join(area, "missing.json"),
          "--installer",
          join(area, "missing.exe"),
        ],
        { stdio: "pipe", windowsHide: true },
      ),
    ).toThrow();
    const result = JSON.parse(
      readFileSync(join(area, "platform-failure.json"), "utf8"),
    ) as { localPassed: boolean; formalAcceptance: string; error: string };
    expect(result.localPassed).toBe(false);
    expect(result.formalAcceptance).toBe("not_established");
    expect(result.error).toContain("ENOENT");
  } finally {
    rmSync(area, { recursive: true, force: true });
  }
});
it("real publish entry refuses incomplete native acceptance before contacting GitHub", () => {
  mkdirSync(resolve(".tmp"), { recursive: true });
  const area = mkdtempSync(resolve(".tmp/desktop-publish-contract-"));
  try {
    const input = join(area, "native.json");
    writeFileSync(
      input,
      JSON.stringify({
        sourceCommit: "a".repeat(40),
        environment: { platform: "win32", arch: "x64" },
        phase: "final",
        checks: {},
        remaining: [],
        localPassed: false,
      }),
    );
    expect(() =>
      execFileSync(
        process.execPath,
        [
          "scripts/run-target-gates.mjs",
          "--phase",
          "publish",
          "--platform-result",
          input,
          "--output",
          join(area, "combined"),
        ],
        { stdio: "pipe", windowsHide: true },
      ),
    ).toThrow();
    const result = JSON.parse(
      readFileSync(join(area, "combined/result.json"), "utf8"),
    ) as { published: boolean; error: string };
    expect(result.published).toBe(false);
    expect(result.error).toContain("publication_acceptance_incomplete");
  } finally {
    rmSync(area, { recursive: true, force: true });
  }
});
