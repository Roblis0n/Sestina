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

  const readme = `# Sestina Research Room 0.2 participant-owned Pilot Kit

This kit records structured behavior facts for the real public Sestina Research Room 0.2 preview. It does not contain the product binary and it never downloads, scans, uploads, or discovers projects automatically.

1. Download the one supported product asset for your platform from:

   https://github.com/Roblis0n/Sestina/releases/tag/v0.2.0

2. Verify the asset against the Release SHA256SUMS file before extraction. Use the local preparation script under install/ only after you already downloaded the asset; the script performs no network request.

3. Verify this kit:

   node bin/sestina-pilot.mjs verify-kit --kit-root <absolute-kit-directory>

4. Read docs/PROTOCOL.md and docs/CONSENT.md. Never pass --consent-acknowledged true unless the participant actually agreed to consent version 2026-08-30.

5. Run the participant-owned local recorder:

   node bin/sestina-pilot.mjs session start ...
   node bin/sestina-pilot.mjs session checkpoint ...
   node bin/sestina-pilot.mjs session finish ...
   node bin/sestina-pilot.mjs session show ...
   node bin/sestina-pilot.mjs session delete ... --yes true
   node bin/sestina-pilot.mjs export ...
   node bin/sestina-pilot.mjs aggregate ...

Private session files stay under the participant-selected local private root. Export and aggregate files appear only after explicit commands. The shareable schema rejects free text, research content, identity, paths, device identifiers, secrets, raw errors, stdout, and stderr. Project-owner, internal, and synthetic sessions never count as independent external evidence.
`;

  const windowsInstall = `param(
  [Parameter(Mandatory = $true)][string]$Artifact,
  [Parameter(Mandatory = $true)][string]$ExpectedSha256,
  [Parameter(Mandatory = $true)][string]$Destination
)
$ErrorActionPreference = "Stop"
$resolvedArtifact = (Resolve-Path -LiteralPath $Artifact).Path
$actual = (Get-FileHash -LiteralPath $resolvedArtifact -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $ExpectedSha256.ToLowerInvariant()) { throw "artifact_checksum_mismatch" }
if (Test-Path -LiteralPath $Destination) { throw "destination_already_exists" }
New-Item -ItemType Directory -Path $Destination | Out-Null
Expand-Archive -LiteralPath $resolvedArtifact -DestinationPath $Destination
Write-Output "Verified and extracted Sestina Research Room 0.2. No network request was made."
`;
  const posixInstall = `#!/usr/bin/env sh
set -eu
test "$#" -eq 3
artifact=$1
expected=$2
destination=$3
test -f "$artifact"
test ! -e "$destination"
actual=$(shasum -a 256 "$artifact" | awk '{print $1}')
test "$actual" = "$expected"
mkdir -p "$destination"
tar -xzf "$artifact" -C "$destination"
printf '%s\n' 'Verified and extracted Sestina Research Room 0.2. No network request was made.'
`;

  async function execute() {
    await assertSafeOutputRoot();
    await rm(stagingRoot, { recursive: true, force: true });
    await mkdir(stagingRoot, { recursive: true });
    try {
      const verifiedRelease = await verifyReleaseDirectory(releaseRoot);
      const releaseManifest = verifiedRelease.manifest;
      if (
        releaseManifest.identity.version !== "0.2.0" ||
        releaseManifest.identity.releaseChannel !== "public_preview" ||
        releaseManifest.distribution.license !== "Apache-2.0"
      ) {
        throw new Error("pilot_release_artifact_invalid");
      }
      const supportedAssets = [
        {
          platform: "windows_x64",
          file: "sestina-research-room-0.2.0-windows-x64.zip",
        },
        {
          platform: "macos_arm64",
          file: "sestina-research-room-0.2.0-macos-arm64.tar.gz",
        },
        {
          platform: "ubuntu_x64",
          file: "sestina-research-room-0.2.0-ubuntu-x64.tar.gz",
        },
      ];
      const releaseBinding = {
        schemaVersion: "1.0.0",
        product: "Sestina Research Room",
        version: "0.2.0",
        channel: "public_preview",
        buildId: releaseManifest.identity.releaseBuildId,
        sourceCommit: releaseManifest.source.gitCommit,
        tag: "v0.2.0",
        repository: "https://github.com/Roblis0n/Sestina",
        releaseUrl: "https://github.com/Roblis0n/Sestina/releases/tag/v0.2.0",
        supportedAssets,
      };

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
        [join(repositoryRoot, "LICENSE"), "LICENSE"],
      ];
      for (const [source, relativePath] of copies) {
        const destination = join(stagingRoot, ...relativePath.split("/"));
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(source, destination);
      }
      await writeText("README.md", readme);
      await writeText(
        "release/RELEASE-BINDING.json",
        JSON.stringify(releaseBinding, null, 2),
      );
      await writeText("install/install-windows.ps1", windowsInstall);
      await writeText("install/install-macos.sh", posixInstall, 0o755);
      await writeText("install/install-linux.sh", posixInstall, 0o755);

      const payloadPaths = [
        "README.md",
        "LICENSE",
        "bin/sestina-pilot.mjs",
        "docs/CONSENT.md",
        "docs/EXIT-INTERVIEW.md",
        "docs/OBSERVATION-FORM.md",
        "docs/PROTOCOL.md",
        "docs/RESULTS-TEMPLATE.md",
        "install/install-linux.sh",
        "install/install-macos.sh",
        "install/install-windows.ps1",
        "release/RELEASE-BINDING.json",
        "schema/shareable-pilot-export.schema.json",
        "walkthrough/SYNTHETIC-WALKTHROUGH.md",
      ].sort((left, right) => left.localeCompare(right, "en"));
      const files = [];
      for (const relativePath of payloadPaths) {
        const bytes = await readFile(join(stagingRoot, ...relativePath.split("/")));
        files.push({ path: relativePath, sha256: sha256(bytes), size: bytes.length });
      }
      const manifest = {
        schemaVersion: "2.0.0",
        pilotKitVersion: "2.0.0",
        protocolVersion: "2026-08-30",
        consentVersion: "2026-08-30",
        sestinaRelease: {
          version: "0.2.0",
          channel: "public_preview",
          buildId: releaseManifest.identity.releaseBuildId,
          sourceCommit: releaseManifest.source.gitCommit,
          tag: "v0.2.0",
          repository: "https://github.com/Roblis0n/Sestina",
          releaseUrl: "https://github.com/Roblis0n/Sestina/releases/tag/v0.2.0",
          supportedAssets,
        },
        files,
        security: {
          localOnly: true,
          noTelemetry: true,
          participantControlledExport: true,
          noAutomaticProjectScan: true,
          noAutomaticUpload: true,
          noFreeTextExport: true,
          noDeviceIdentifiers: true,
          noRawErrors: true,
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
        `${JSON.stringify({ ok: true, pilotKitVersion: "2.0.0", releaseVersion: releaseManifest.identity.version, releaseBuildId: releaseManifest.identity.releaseBuildId, sourceCommit: releaseManifest.source.gitCommit, files: files.length })}\n`,
      );
    } catch (error) {
      await rm(stagingRoot, { recursive: true, force: true });
      throw error;
    }
  }

  await execute();
}
