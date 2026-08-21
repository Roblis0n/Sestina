import { resolve } from "node:path";
import { verifyReleaseDirectory } from "./lib/release-verifier.mjs";

const argument = process.argv[2];
if (process.argv.length > 3 || (argument !== undefined && argument.startsWith("--"))) {
  process.stderr.write("Usage: node scripts/verify-release-artifact.mjs [release-directory]\n"); process.exitCode = 2;
} else {
  const releaseDirectory = resolve(argument ?? "release");
  try {
    const result = await verifyReleaseDirectory(releaseDirectory);
    process.stdout.write(`${JSON.stringify({ ok: true, releaseDirectory, version: result.manifest.identity.version, releaseBuildId: result.manifest.identity.releaseBuildId, verifiedFiles: result.verifiedFiles })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "release_verification_failed" })}\n`); process.exitCode = 1;
  }
}
