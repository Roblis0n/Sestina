import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  fileSha256,
  inspectDesktopReadiness,
} from "./lib/desktop-readiness.mjs";

// Read-only prerequisite check: never installs, changes a gate, executes an
// evidence-supplied command, runs remote CI, switches defaults, or publishes.
let outputPath;
try {
  const { values } = parseArgs({
    options: {
      inventory: { type: "string" },
      installed: { type: "string" },
      manifest: { type: "string" },
      output: { type: "string" },
    },
  });
  outputPath = values.output ? resolve(values.output) : undefined;
  if (
    !values.inventory ||
    Boolean(values.installed) !== Boolean(values.manifest)
  )
    throw new Error(
      "Usage: verify:desktop:readiness --inventory <json> [--installed <directory> --manifest <json>] [--output <json>]",
    );
  const inventoryPath = resolve(values.inventory);
  const input = JSON.parse(readFileSync(inventoryPath, "utf8"));
  const result = inspectDesktopReadiness(input, dirname(inventoryPath));
  result.inventorySha256 = fileSha256(inventoryPath);
  if (values.installed) {
    const manifestPath = resolve(values.manifest);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (
      process.platform !== "win32" ||
      process.arch !== "x64" ||
      manifest.platform !== "win32" ||
      manifest.arch !== "x64" ||
      manifest.sourceCommit !== input.sourceCommit
    )
      throw new Error(
        "installed_verifier_requires_matching_windows_x64_source",
      );
    const check = spawnSync(
      process.execPath,
      [
        resolve(import.meta.dirname, "verify-desktop-artifact.mjs"),
        resolve(values.installed),
        manifestPath,
        input.sourceCommit,
      ],
      {
        cwd: resolve(import.meta.dirname, ".."),
        encoding: "utf8",
        windowsHide: true,
      },
    );
    const passed = !check.error && check.status === 0;
    result.installedArtifact = {
      status: passed ? "passed" : "failed",
      sourceCommit: manifest.sourceCommit,
      platform: manifest.platform,
      arch: manifest.arch,
      manifestSha256: fileSha256(manifestPath),
      signed: manifest.signed,
      exitCode: check.status,
      output: check.stdout,
      error: check.error?.message ?? check.stderr,
    };
    if (!passed) result.remainingPrerequisitesSatisfied = false;
  }
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) writeFileSync(outputPath, output);
  process.stdout.write(output);
  process.exitCode = result.remainingPrerequisitesSatisfied ? 0 : 1;
} catch (error) {
  if (outputPath) {
    try {
      writeFileSync(
        outputPath,
        `${JSON.stringify(
          {
            schema: 1,
            scope: "remaining_g10_g11_evidence_only",
            sourceCommit: null,
            remainingPrerequisitesSatisfied: false,
            g12Acceptance: "not_executed",
            g13Cutover: "not_executed",
            errors: [error.message],
            checks: [],
          },
          null,
          2,
        )}\n`,
      );
    } catch (outputError) {
      process.stderr.write(
        `desktop_readiness_output_failed: ${outputError.message}\n`,
      );
    }
  }
  process.stderr.write(`desktop_readiness_failed: ${error.message}\n`);
  process.exitCode = 1;
}
