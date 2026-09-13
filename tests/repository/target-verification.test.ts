import { expect, it } from "vitest";
import {
  assertExecutedTests,
  canReuseTargetCheck,
  desktopResources,
  assertDesktopBinary,
  targetCheckAffected,
} from "../../scripts/lib/target-verification.mjs";

it("source-reviewed reuse keeps test-only repairs separate and invalidates changed runtime or check implementations", () => {
  expect(
    targetCheckAffected("performance", [
      "apps/research-room/test/production-entry.test.ts",
    ]),
  ).toBe(false);
  expect(
    targetCheckAffected("public", [
      "apps/research-room/test/production-entry.test.ts",
    ]),
  ).toBe(true);
  expect(
    targetCheckAffected("performance", [
      "tests/desktop/installed-resources.ts",
    ]),
  ).toBe(false);
  expect(
    targetCheckAffected("resources", ["tests/desktop/installed-resources.ts"]),
  ).toBe(true);
  for (const path of [
    "apps/desktop/src/main.ts",
    "scripts/build-desktop.mjs",
    "packages/core/src/kernel.ts",
    "unrecognized-build-input.json",
  ])
    expect(targetCheckAffected("performance", [path])).toBe(true);
  expect(
    targetCheckAffected("artifact", ["scripts/verify-desktop-artifact.mjs"]),
  ).toBe(true);
});

it("installed verification follows native resource layouts and rejects wrong platform binaries", () => {
  expect(desktopResources("/app", "darwin").replaceAll("\\", "/")).toBe(
    "/app/Contents/Resources",
  );
  const elf = Buffer.alloc(64);
  elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
  elf.writeUInt16LE(62, 18);
  expect(() => assertDesktopBinary(elf, "linux", "x64")).not.toThrow();
  expect(() => assertDesktopBinary(elf, "darwin", "arm64")).toThrow();
  const mach = Buffer.alloc(32);
  mach.writeUInt32LE(0xfeedfacf);
  mach.writeUInt32LE(0x100000c, 4);
  expect(() => assertDesktopBinary(mach, "darwin", "arm64")).not.toThrow();
  expect(() => assertDesktopBinary(mach, "linux", "x64")).toThrow();
});

it("target verification rejects zero, incomplete and skipped Vitest results", () => {
  const report = {
    numTotalTests: 1,
    numPassedTests: 1,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    testResults: [{ assertionResults: [{ status: "passed" }] }],
  };
  expect(assertExecutedTests(report)).toBe(1);
  for (const mutation of [
    { numTotalTests: 0 },
    { numPassedTests: 0 },
    { numFailedTests: 1 },
    { numPendingTests: 1 },
    { numTodoTests: 1 },
    { testResults: [] },
  ])
    expect(() => assertExecutedTests({ ...report, ...mutation })).toThrow();
});

it("target reuse binds executed evidence to source scope, platform, artifact and unchanged raw output", () => {
  const binding = {
    sourceScope: "a",
    platform: "win32-x64",
    artifact: "b",
    runtime: "node24",
  };
  const record = { status: "passed", binding, evidenceSha256: "c", count: 1 };
  expect(canReuseTargetCheck(record, binding, "c")).toBe(true);
  for (const changed of [
    { ...binding, sourceScope: "changed" },
    { ...binding, platform: "darwin-arm64" },
    { ...binding, artifact: "new" },
  ])
    expect(canReuseTargetCheck(record, changed, "c")).toBe(false);
  expect(canReuseTargetCheck(record, binding, "replaced log")).toBe(false);
  expect(canReuseTargetCheck({ ...record, count: 0 }, binding, "c")).toBe(
    false,
  );
  expect(
    canReuseTargetCheck({ ...record, status: "not_run" }, binding, "c"),
  ).toBe(false);
});
