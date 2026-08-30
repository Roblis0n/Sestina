import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const releaseRoot = join(root, "release");
const rawArguments = process.argv.slice(2);
const argumentsWithoutSeparator =
  rawArguments[0] === "--" ? rawArguments.slice(1) : rawArguments;
const [expectedOs, expectedArchitecture] = argumentsWithoutSeparator;

if (
  argumentsWithoutSeparator.length !== 2 ||
  !["win32", "darwin", "linux"].includes(expectedOs) ||
  !["x64", "arm64"].includes(expectedArchitecture)
) {
  process.stderr.write(
    "Usage: node scripts/run-ri54-platform-gates.mjs <win32|darwin|linux> <x64|arm64>\n",
  );
  process.exit(2);
}
if (
  process.platform !== expectedOs ||
  process.arch !== expectedArchitecture
) {
  process.stderr.write(
    `[RI-54] runner mismatch: expected ${expectedOs}-${expectedArchitecture}, got ${process.platform}-${process.arch}\n`,
  );
  process.exit(1);
}

function run(label, entry, args = []) {
  process.stdout.write(`\n[RI-54 ${process.platform}-${process.arch}] ${label}\n`);
  const result = spawnSync(process.execPath, [resolve(root, entry), ...args], {
    cwd: root,
    env: { ...process.env, CI: "true", NO_COLOR: "1" },
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    process.stderr.write(
      `[RI-54 ${process.platform}-${process.arch}] failed: ${label}\n`,
    );
    process.exit(result.status ?? 1);
  }
}

async function releaseFingerprint() {
  const records = [];
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name, "en"),
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const bytes = await readFile(path);
        const metadata = await stat(path);
        records.push({
          path: relative(releaseRoot, path).replaceAll("\\", "/"),
          size: bytes.length,
          mode: metadata.mode & 0o777,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      } else {
        throw new Error("release_contains_link_or_special_entry");
      }
    }
  }
  await visit(releaseRoot);
  return JSON.stringify(records);
}

run("build public-preview artifact pass 1", "scripts/build-release.mjs");
const first = await releaseFingerprint();
run("build public-preview artifact pass 2", "scripts/build-release.mjs");
const second = await releaseFingerprint();
if (first !== second) {
  process.stderr.write("[RI-54] deterministic rebuild mismatch\n");
  process.exit(1);
}
run("verify exact artifact contract", "scripts/verify-release-artifact.mjs", [
  "release",
]);
run(
  "exercise clean extraction, no-network first/open/reopen, rc continuity, backup/restore, failed migration no-retry, future schema refusal, restart, uninstall, and reinstall",
  "scripts/run-fresh-install.mjs",
  ["--release-dir", "release"],
);
process.stdout.write(
  `${JSON.stringify({
    ok: true,
    gate: "ri54-platform-public-preview",
    platform: process.platform,
    architecture: process.arch,
    deterministicRebuild: true,
    lifecycle: true,
  })}\n`,
);
