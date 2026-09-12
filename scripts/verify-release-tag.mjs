import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";

const [tag, directory = "release"] = process.argv.slice(2);
if (process.argv.length < 3 || process.argv.length > 4 || typeof tag !== "string") {
  process.stderr.write("Usage: node scripts/verify-release-tag.mjs <tag> [release-directory]\n"); process.exitCode = 2;
} else {
  try {
    const manifest = JSON.parse(await readFile(join(resolve(directory), "release-manifest.json"), "utf8"));
    const expected = `v${manifest.identity?.version ?? ""}`;
    if (tag !== expected) throw new Error(`release_tag_version_mismatch:${tag}:${expected}`);
    if (!/^v[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(tag)) throw new Error("release_tag_invalid");
    const tagCommit = execFileSync("git", ["rev-parse", "--verify", `refs/tags/${tag}^{commit}`], { cwd: resolve(import.meta.dirname, ".."), windowsHide: true, encoding: "utf8" }).trim();
    if (manifest.source?.gitCommit !== tagCommit) throw new Error("release_tag_source_mismatch");
    process.stdout.write(`${JSON.stringify({ ok: true, tag, version: manifest.identity.version, releaseBuildId: manifest.identity.releaseBuildId })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "release_tag_verification_failed" })}\n`); process.exitCode = 1;
  }
}
