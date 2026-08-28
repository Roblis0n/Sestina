import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const releaseRoot = join(root, "release");

function run(label, entry, args = []) {
  process.stdout.write("\n[RI-53 " + process.platform + "] " + label + "\n");
  const result = spawnSync(process.execPath, [resolve(root, entry), ...args], {
    cwd: root,
    env: { ...process.env, CI: "true", NO_COLOR: "1" },
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    process.stderr.write("[RI-53 " + process.platform + "] failed: " + label + "\n");
    process.exit(result.status ?? 1);
  }
}

async function releaseFingerprint() {
  const records = [];
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name, "en"))) {
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
      } else throw new Error("release_contains_link_or_special_entry");
    }
  }
  await visit(releaseRoot);
  return JSON.stringify(records);
}

run("build product artifact pass 1", "scripts/build-release.mjs");
const first = await releaseFingerprint();
run("build product artifact pass 2", "scripts/build-release.mjs");
const second = await releaseFingerprint();
if (first !== second) {
  process.stderr.write("[RI-53 " + process.platform + "] deterministic rebuild mismatch\n");
  process.exit(1);
}
run("verify exact artifact contract", "scripts/verify-release-artifact.mjs", ["release"]);
run("exercise install, recovery, upgrade, failure, restart, uninstall, and reinstall", "scripts/run-fresh-install.mjs", ["--release-dir", "release"]);
process.stdout.write(JSON.stringify({
  ok: true,
  gate: "ri53-platform",
  platform: process.platform,
  architecture: process.arch,
  deterministicRebuild: true,
  lifecycle: true,
}) + "\n");
