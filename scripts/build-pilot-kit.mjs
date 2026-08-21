#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { build } from "esbuild";

import { verifyReleaseDirectory } from "./lib/release-verifier.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
if (args.length > 2 || args.some((value) => value.startsWith("--"))) {
  process.stderr.write("Usage: node scripts/build-pilot-kit.mjs [release-directory] [output-directory]\n");
  process.exitCode = 2;
} else {
  const releaseRoot = resolve(args[0] ?? join(repositoryRoot, "release"));
  const outputRoot = resolve(
    args[1] ?? join(repositoryRoot, "pilot-dist", "sestina-pilot-kit"),
  );
  const stagingRoot = join(
    dirname(outputRoot),
    `.sestina-pilot-kit-staging-${process.pid}-${randomBytes(8).toString("hex")}`,
  );
  const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const normalized = (path) =>
    process.platform === "win32" ? path.toLowerCase() : path;
  const contains = (parent, target) => {
    const value = relative(parent, target);
    return value.length === 0 ||
      (value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value));
  };
  const assertSafeOutputRoot = async () => {
    const parent = dirname(outputRoot);
    if (
      outputRoot === parse(outputRoot).root ||
      outputRoot === parent ||
      contains(outputRoot, repositoryRoot) ||
      contains(outputRoot, releaseRoot) ||
      contains(releaseRoot, outputRoot)
    ) {
      throw new Error("pilot_output_root_unsafe");
    }
    await mkdir(parent, { recursive: true });
    if (normalized(await realpath(parent)) !== normalized(parent)) {
      throw new Error("pilot_output_root_unsafe");
    }
    try {
      const stat = await lstat(outputRoot);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error("pilot_output_root_unsafe");
      }
    } catch (error) {
      if (error instanceof Error && error.message === "pilot_output_root_unsafe") {
        throw error;
      }
      if (error?.code !== "ENOENT") throw error;
    }
  };
  const writeText = async (relativePath, content, mode = 0o644) => {
    const path = join(stagingRoot, ...relativePath.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content.endsWith("\n") ? content : `${content}\n`, {
      encoding: "utf8",
      mode,
    });
  };

  const readme = `# Sestina RI-43 local Pilot Kit

This kit runs entirely on the participant's machine with Node.js 24. It does not upload, discover a server, read a research project, or modify Sestina research state.

1. Verify the kit before use:

   node bin/sestina-pilot.mjs verify-kit --kit-root <absolute-kit-directory>

2. Install the bound Sestina private preview without lifecycle scripts:

   npm install --global --offline --ignore-scripts ./release/<bound-sestina-tarball>

   The scripts under install/ perform the same local installation on Windows, macOS, and Linux.

3. Read docs/PROTOCOL.md and docs/CONSENT.md. Never pass --consent-acknowledged true unless the participant has actually agreed to consent version 2026-08-21.

4. Run the local recorder. The command surface is:

   node bin/sestina-pilot.mjs session start ...
   node bin/sestina-pilot.mjs session checkpoint ...
   node bin/sestina-pilot.mjs session finish ...
   node bin/sestina-pilot.mjs session show ...
   node bin/sestina-pilot.mjs session delete ... --yes true
   node bin/sestina-pilot.mjs export ...
   node bin/sestina-pilot.mjs aggregate ...

Private session files remain under the explicitly supplied local private root. Shareable export and aggregate files are created only by explicit commands. Free text and research content are not accepted by the shareable schema.
`;

  const windowsInstall = `$ErrorActionPreference = "Stop"
$kitRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $kitRoot "pilot-kit-manifest.json") -Raw | ConvertFrom-Json
$artifact = Join-Path $kitRoot ("release/" + $manifest.sestinaRelease.artifactFile)
& npm install --global --offline --ignore-scripts $artifact
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
`;
  const posixInstall = `#!/usr/bin/env sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
kit_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
artifact=$(find "$kit_root/release" -maxdepth 1 -type f -name 'sestina-cli-*.tgz' -print)
test -n "$artifact"
test "$(printf '%s\n' "$artifact" | wc -l | tr -d ' ')" = "1"
npm install --global --offline --ignore-scripts "$artifact"
`;

  async function execute() {
    await assertSafeOutputRoot();
    await rm(stagingRoot, { recursive: true, force: true });
    await mkdir(stagingRoot, { recursive: true });
    try {
      const verifiedRelease = await verifyReleaseDirectory(releaseRoot);
      const releaseManifest = verifiedRelease.manifest;
      const npmArtifact = releaseManifest.artifacts.find(
        (artifact) => artifact.kind === "npm-tarball",
      );
      if (
        npmArtifact === undefined ||
        npmArtifact.file !==
          `sestina-cli-${releaseManifest.identity.version}.tgz`
      ) {
        throw new Error("pilot_release_artifact_invalid");
      }

      const runnerPath = join(stagingRoot, "bin", "sestina-pilot.mjs");
      await mkdir(dirname(runnerPath), { recursive: true });
      await build({
        entryPoints: [join(repositoryRoot, "packages", "pilot", "src", "main.ts")],
        outfile: runnerPath,
        bundle: true,
        platform: "node",
        target: "node24",
        format: "esm",
        sourcemap: false,
        legalComments: "none",
        minify: false,
        logLevel: "silent",
      });
      await chmod(runnerPath, 0o755);

      const copies = [
        [
          join(repositoryRoot, "packages", "pilot", "schema", "shareable-pilot-export.schema.json"),
          "schema/shareable-pilot-export.schema.json",
        ],
        [join(repositoryRoot, "docs", "pilot", "PROTOCOL.md"), "docs/PROTOCOL.md"],
        [join(repositoryRoot, "docs", "pilot", "CONSENT.md"), "docs/CONSENT.md"],
        [join(repositoryRoot, "docs", "pilot", "OBSERVATION-FORM.md"), "docs/OBSERVATION-FORM.md"],
        [join(repositoryRoot, "docs", "pilot", "EXIT-INTERVIEW.md"), "docs/EXIT-INTERVIEW.md"],
        [join(repositoryRoot, "docs", "pilot", "RESULTS-TEMPLATE.md"), "docs/RESULTS-TEMPLATE.md"],
        [join(repositoryRoot, "docs", "pilot", "SYNTHETIC-WALKTHROUGH.md"), "walkthrough/SYNTHETIC-WALKTHROUGH.md"],
        [join(releaseRoot, npmArtifact.file), `release/${npmArtifact.file}`],
      ];
      for (const [source, relativePath] of copies) {
        const destination = join(stagingRoot, ...relativePath.split("/"));
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(source, destination);
      }
      await writeText("README.md", readme.replace("<bound-sestina-tarball>", npmArtifact.file));
      await writeText("install/install-windows.ps1", windowsInstall);
      await writeText("install/install-macos.sh", posixInstall, 0o755);
      await writeText("install/install-linux.sh", posixInstall, 0o755);

      const payloadPaths = [
        "README.md",
        "bin/sestina-pilot.mjs",
        "docs/CONSENT.md",
        "docs/EXIT-INTERVIEW.md",
        "docs/OBSERVATION-FORM.md",
        "docs/PROTOCOL.md",
        "docs/RESULTS-TEMPLATE.md",
        "install/install-linux.sh",
        "install/install-macos.sh",
        "install/install-windows.ps1",
        `release/${npmArtifact.file}`,
        "schema/shareable-pilot-export.schema.json",
        "walkthrough/SYNTHETIC-WALKTHROUGH.md",
      ].sort((left, right) => left.localeCompare(right, "en"));
      const files = [];
      for (const relativePath of payloadPaths) {
        const bytes = await readFile(join(stagingRoot, ...relativePath.split("/")));
        files.push({ path: relativePath, sha256: sha256(bytes), size: bytes.length });
      }
      const manifest = {
        schemaVersion: "1.0.0",
        pilotKitVersion: "1.0.0",
        protocolVersion: "2026-08-21",
        consentVersion: "2026-08-21",
        sestinaRelease: {
          version: releaseManifest.identity.version,
          buildId: releaseManifest.identity.releaseBuildId,
          artifactFile: npmArtifact.file,
          artifactSha256: npmArtifact.sha256,
        },
        files,
        security: {
          localOnly: true,
          noTelemetry: true,
          participantControlledExport: true,
          containsResearchContent: false,
          containsCredentials: false,
        },
      };
      const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
      await writeFile(join(stagingRoot, "pilot-kit-manifest.json"), manifestBytes);
      const sums = [
        ...files.map((file) => [file.path, file.sha256]),
        ["pilot-kit-manifest.json", sha256(manifestBytes)],
      ]
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([path, digest]) => `${digest}  ${path}`)
        .join("\n");
      await writeFile(join(stagingRoot, "SHA256SUMS"), `${sums}\n`, "utf8");

      execFileSync(
        process.execPath,
        [runnerPath, "verify-kit", "--kit-root", stagingRoot],
        { cwd: stagingRoot, stdio: "pipe", windowsHide: true },
      );
      await mkdir(dirname(outputRoot), { recursive: true });
      await rm(outputRoot, { recursive: true, force: true });
      await rename(stagingRoot, outputRoot);
      process.stdout.write(
        `${JSON.stringify({ ok: true, pilotKitVersion: "1.0.0", releaseVersion: releaseManifest.identity.version, releaseBuildId: releaseManifest.identity.releaseBuildId, files: files.length })}\n`,
      );
    } catch (error) {
      await rm(stagingRoot, { recursive: true, force: true });
      throw error;
    }
  }

  await execute();
}
