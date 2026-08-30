#!/usr/bin/env node

import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { createDeterministicZip, inspectZip } from "./lib/archive.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);

if (args.length > 2 || args.some((value) => value.startsWith("--"))) {
  process.stderr.write(
    "Usage: node scripts/package-pilot-kit.mjs [pilot-kit-directory] [output-zip]\n",
  );
  process.exitCode = 2;
} else {
  const kitRoot = resolve(
    args[0] ?? join(repositoryRoot, "pilot-dist", "sestina-pilot-kit"),
  );
  const output = resolve(
    args[1] ??
      join(
        repositoryRoot,
        "pilot-dist",
        "sestina-research-room-0.2.0-pilot-kit.zip",
      ),
  );
  const archiveRoot = "sestina-research-room-0.2.0-pilot-kit";

  const { verifyPilotKit } = await import("../packages/pilot/dist/kit.js");
  const verified = await verifyPilotKit(kitRoot);
  const entries = [];

  async function visit(directory) {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name, "en"),
    )) {
      const source = join(directory, item.name);
      if (item.isDirectory()) {
        await visit(source);
      } else if (item.isFile()) {
        const path = relative(kitRoot, source).replaceAll("\\", "/");
        const mode =
          path === "bin/sestina-pilot.mjs" || path.endsWith(".sh")
            ? 0o755
            : 0o644;
        entries.push({
          path: `${archiveRoot}/${path}`,
          data: await readFile(source),
          mode,
        });
      } else {
        throw new Error(`pilot_kit_link_or_special_file:${source}`);
      }
    }
  }

  await visit(kitRoot);
  await rm(output, { force: true });
  await createDeterministicZip(output, entries);
  const inspected = await inspectZip(output);
  if (
    inspected.length !== entries.length ||
    inspected.some((entry) => !entry.path.startsWith(`${archiveRoot}/`))
  ) {
    throw new Error("pilot_kit_archive_verification_failed");
  }
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      output,
      size: (await stat(output)).size,
      files: inspected.length,
      pilotKitVersion: verified.manifest.pilotKitVersion,
      releaseBuildId: verified.manifest.sestinaRelease.buildId,
      sourceCommit: verified.manifest.sestinaRelease.sourceCommit,
    })}\n`,
  );
}
