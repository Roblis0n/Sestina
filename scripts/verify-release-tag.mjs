import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const [tag, directory = "release"] = process.argv.slice(2);
if (process.argv.length < 3 || process.argv.length > 4 || typeof tag !== "string") {
  process.stderr.write("Usage: node scripts/verify-release-tag.mjs <tag> [release-directory]\n"); process.exitCode = 2;
} else {
  try {
    const manifest = JSON.parse(await readFile(join(resolve(directory), "release-manifest.json"), "utf8"));
    const expected = `v${manifest.identity?.version ?? ""}`;
    if (tag !== expected) throw new Error(`release_tag_version_mismatch:${tag}:${expected}`);
    process.stdout.write(`${JSON.stringify({ ok: true, tag, version: manifest.identity.version, releaseBuildId: manifest.identity.releaseBuildId })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "release_tag_verification_failed" })}\n`); process.exitCode = 1;
  }
}
