#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { verifyReleaseDirectory } from "./lib/release-verifier.mjs";
import {
  PUBLIC_RELEASE_LAYOUT,
  verifyPublicReleaseDirectory,
} from "./lib/public-release-verifier.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
if (args.length !== 4 && args.length !== 5) {
  process.stderr.write(
    "Usage: node scripts/assemble-public-release.mjs <windows-release-dir> <macos-release-dir> <ubuntu-release-dir> <pilot-kit-zip> [output-dir]\n",
  );
  process.exitCode = 2;
} else {
  const inputDirectories = args.slice(0, 3).map((path) => resolve(path));
  const pilotZip = resolve(args[3]);
  const output = resolve(args[4] ?? join(repositoryRoot, "public-release"));
  const staging = join(
    dirname(output),
    `.sestina-public-release-staging-${process.pid}`,
  );
  const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    const verified = [];
    for (let index = 0; index < inputDirectories.length; index += 1) {
      const release = await verifyReleaseDirectory(inputDirectories[index]);
      const expected = PUBLIC_RELEASE_LAYOUT.platforms[index];
      if (
        release.manifest.platform.os !== expected.os ||
        release.manifest.platform.architecture !== expected.architecture ||
        release.manifest.distribution.primaryArtifact !== expected.file
      ) {
        throw new Error(`public_release_input_platform_invalid:${expected.key}`);
      }
      verified.push(release);
    }
    const buildIds = new Set(
      verified.map((release) => release.manifest.identity.releaseBuildId),
    );
    const sourceCommits = new Set(
      verified.map((release) => release.manifest.source.gitCommit),
    );
    if (buildIds.size !== 1 || sourceCommits.size !== 1) {
      throw new Error("public_release_cross_platform_identity_drift");
    }
    const releaseBuildId = verified[0].manifest.identity.releaseBuildId;
    const sourceCommit = verified[0].manifest.source.gitCommit;

    const artifacts = [];
    for (let index = 0; index < verified.length; index += 1) {
      const release = verified[index];
      const expected = PUBLIC_RELEASE_LAYOUT.platforms[index];
      const sourceArtifact = join(inputDirectories[index], expected.file);
      const targetArtifact = join(staging, expected.file);
      const sourceManifest = join(
        inputDirectories[index],
        "release-manifest.json",
      );
      const targetManifest = join(staging, expected.manifestFile);
      await copyFile(sourceArtifact, targetArtifact);
      await copyFile(sourceManifest, targetManifest);
      const bytes = await readFile(targetArtifact);
      artifacts.push({
        platform: expected.key,
        os: expected.os,
        architecture: expected.architecture,
        file: expected.file,
        manifestFile: expected.manifestFile,
        sha256: sha256(bytes),
        size: bytes.length,
      });
    }

    const pilotFile = PUBLIC_RELEASE_LAYOUT.pilotFile;
    const targetPilot = join(staging, pilotFile);
    await copyFile(pilotZip, targetPilot);
    const pilotBytes = await readFile(targetPilot);
    const index = {
      schemaVersion: "1.0.0",
      product: "Sestina Research Room",
      version: "0.2.0",
      channel: "public_preview",
      tag: "v0.2.0",
      license: "Apache-2.0",
      repository: "https://github.com/Roblis0n/Sestina",
      releaseUrl: "https://github.com/Roblis0n/Sestina/releases/tag/v0.2.0",
      releaseBuildId,
      sourceCommit,
      artifacts,
      pilotKit: {
        file: pilotFile,
        sha256: sha256(pilotBytes),
        size: pilotBytes.length,
        pilotKitVersion: "2.0.0",
        protocolVersion: "2026-08-30",
        consentVersion: "2026-08-30",
      },
    };
    const indexBytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`);
    await writeFile(join(staging, PUBLIC_RELEASE_LAYOUT.indexFile), indexBytes);
    const filesToHash = [
      ...artifacts.flatMap((artifact) => [artifact.file, artifact.manifestFile]),
      pilotFile,
      PUBLIC_RELEASE_LAYOUT.indexFile,
    ].sort((left, right) => left.localeCompare(right, "en"));
    const sums = [];
    for (const file of filesToHash) {
      sums.push(`${sha256(await readFile(join(staging, file)))}  ${file}`);
    }
    await writeFile(
      join(staging, PUBLIC_RELEASE_LAYOUT.sumsFile),
      `${sums.join("\n")}\n`,
    );
    await verifyPublicReleaseDirectory(staging);
    await rm(output, { recursive: true, force: true });
    await rename(staging, output);
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        output,
        releaseBuildId,
        sourceCommit,
        files: (await stat(join(output, PUBLIC_RELEASE_LAYOUT.indexFile))).isFile()
          ? filesToHash.length + 1
          : 0,
      })}\n`,
    );
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
