#!/usr/bin/env node

import { resolve } from "node:path";

import { verifyPublicReleaseDirectory } from "./lib/public-release-verifier.mjs";

const argument = process.argv[2];
if (
  process.argv.length > 3 ||
  (argument !== undefined && argument.startsWith("--"))
) {
  process.stderr.write(
    "Usage: node scripts/verify-public-release.mjs [public-release-directory]\n",
  );
  process.exitCode = 2;
} else {
  try {
    const result = await verifyPublicReleaseDirectory(
      resolve(argument ?? "public-release"),
    );
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        version: result.index.version,
        channel: result.index.channel,
        releaseBuildId: result.index.releaseBuildId,
        sourceCommit: result.index.sourceCommit,
        verifiedFiles: result.verifiedFiles.length,
      })}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "public_release_verification_failed",
      })}\n`,
    );
    process.exitCode = 1;
  }
}
