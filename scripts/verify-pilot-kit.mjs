#!/usr/bin/env node

import { resolve } from "node:path";

const argument = process.argv[2];
if (process.argv.length > 3 || argument === undefined || argument.startsWith("--")) {
  process.stderr.write("Usage: node scripts/verify-pilot-kit.mjs <pilot-kit-directory>\n");
  process.exitCode = 2;
} else {
  try {
    const { verifyPilotKit } = await import("../packages/pilot/dist/kit.js");
    const verified = await verifyPilotKit(resolve(argument));
    process.stdout.write(
      `${JSON.stringify({ ok: true, pilotKitVersion: verified.manifest.pilotKitVersion, releaseVersion: verified.manifest.sestinaRelease.version, releaseBuildId: verified.manifest.sestinaRelease.buildId, verifiedFiles: verified.verifiedFiles.length })}\n`,
    );
  } catch (error) {
    const allowed = new Set([
      "pilot_kit_root_invalid",
      "pilot_kit_unsafe_path",
      "pilot_kit_manifest_invalid",
      "pilot_kit_case_collision",
      "pilot_kit_extra_file",
      "pilot_kit_missing_file",
      "pilot_kit_hash_mismatch",
      "pilot_kit_sums_invalid",
    ]);
    const raw = error instanceof Error ? error.message : "";
    process.stderr.write(
      `${JSON.stringify({ ok: false, error: allowed.has(raw) ? raw : "pilot_kit_verification_failed" })}\n`,
    );
    process.exitCode = 1;
  }
}
