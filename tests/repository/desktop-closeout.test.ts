import { expect, it } from "vitest";
import {
  desktopEvidenceArguments,
  assertLifecycleResult,
  assertReinstallResult,
  assertReadinessBinding,
  aggregateTargetResults,
} from "../../scripts/lib/target-verification.mjs";

// Synthetic contracts only; these records never supply platform acceptance.
const binding = { sourceCommit: "a".repeat(40), installerSha256: "b".repeat(64), platform: "linux", arch: "x64" };
it("passes every supplied observation through both desktop entry layers", () => {
  const input = Object.fromEntries(["lifecycle-result", "reinstall-result", "visual-observation", "readiness", "shared-public"].map(key => [key, `${key}.json`]));
  expect(desktopEvidenceArguments(input)).toEqual(Object.entries(input).flatMap(([key, value]) => [`--${key}`, value]));
});
it("cannot accept arbitrary or partially executed lifecycle cases", () => {
  expect(() => assertLifecycleResult({ ...binding, passed: true, cases: ["anything"] }, binding)).toThrow();
  const cases = ["actual-install", "native-credential-backend", "upgrade-and-pre-upgrade-backup", "preserved-program-recovery", "uninstall-reinstall"];
  expect(() => assertLifecycleResult({ ...binding, passed: true, cases }, binding)).not.toThrow();
  for (const extra of [{ arch: "arm64" }, { skipped: 1 }, { todo: 1 }, { cases: cases.slice(1) }, { cases: [...cases, { id: "failed", status: "failed" }] }])
    expect(() => assertLifecycleResult({ ...binding, passed: true, cases, ...extra }, binding)).toThrow();
});
it("requires OS-specific uninstall execution instead of accepting Windows silent evidence on Linux", () => {
  const common = ["project-brief-preserved-and-reopened", "settings-and-encrypted-credential-preserved", "actual-reinstall-same-package"];
  expect(() => assertReinstallResult({ ...binding, passed: true, cases: ["current-package-actual-silent-uninstall", ...common] }, binding)).toThrow();
  expect(() => assertReinstallResult({ ...binding, passed: true, cases: ["current-package-appimage-removal", ...common] }, binding)).not.toThrow();
});
it("binds readiness to the active package before any observation can close a requirement", () => {
  const input = { sourceCommit: binding.sourceCommit, artifacts: { "linux-x64": { sha256: binding.installerSha256 } } };
  expect(() => assertReadinessBinding(input, binding)).not.toThrow();
  expect(() => assertReadinessBinding({ ...input, sourceCommit: "c".repeat(40) }, binding)).toThrow();
  expect(() => assertReadinessBinding(input, { ...binding, installerSha256: "d".repeat(64) })).toThrow();
});
it("merges only distinct native targets from one source and keeps missing platforms explicit", () => {
  const result = { ...binding, environment: { platform: "linux", arch: "x64" }, phase: "final", localPassed: true, platformAcceptance: "not_established", checks: { artifact: { status: "passed", count: 1 } }, remaining: [{ id: "linux-x64.native-focus", status: "not_established" }] };
  const combined = aggregateTargetResults([result]);
  expect(combined.formalAcceptance).toBe("not_established");
  expect(combined.remaining.some((item: any) => item.id === "darwin-arm64.execution")).toBe(true);
  expect(() => aggregateTargetResults([result, result])).toThrow("duplicate_platform_result");
  expect(() => aggregateTargetResults([result, { ...result, sourceCommit: "c".repeat(40), environment: { platform: "win32", arch: "x64" } }])).toThrow("platform_source_mismatch");
});
