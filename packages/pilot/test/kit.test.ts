import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  PILOT_CONSENT_VERSION,
  PILOT_KIT_MANIFEST_SCHEMA_VERSION,
  PILOT_KIT_VERSION,
  PILOT_PROTOCOL_VERSION,
} from "../src/contracts.js";
import { verifyPilotKit } from "../src/index.js";

const temporaryRoots: string[] = [];
const FIXTURE_RELEASE_VERSION = "0.1.0";
const FIXTURE_RELEASE_BUILD_ID = "a".repeat(64);
const STATIC_PAYLOAD_PATHS = [
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
  "schema/shareable-pilot-export.schema.json",
  "walkthrough/SYNTHETIC-WALKTHROUGH.md",
] as const;

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function filesUnder(root: string, current = root, result: string[] = []): string[] {
  for (const name of readdirSync(current).sort()) {
    const path = join(current, name);
    if (statSync(path).isDirectory()) filesUnder(root, path, result);
    else result.push(path.slice(root.length + 1).replaceAll("\\", "/"));
  }
  return result;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function materializeFixtureKit(output: string): void {
  const artifactFile = `sestina-cli-${FIXTURE_RELEASE_VERSION}.tgz`;
  const payload = new Map<string, Buffer>();
  for (const relativePath of STATIC_PAYLOAD_PATHS) {
    payload.set(relativePath, Buffer.from(`deterministic fixture: ${relativePath}\n`, "utf8"));
  }
  payload.set(`release/${artifactFile}`, Buffer.from("deterministic cli archive fixture\n", "utf8"));

  const files = [...payload.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([path, bytes]) => ({ path, sha256: sha256(bytes), size: bytes.length }));
  for (const [relativePath, bytes] of payload) {
    const target = join(output, ...relativePath.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }

  const artifactSha256 = sha256(payload.get(`release/${artifactFile}`) ?? Buffer.alloc(0));
  const manifest = {
    schemaVersion: PILOT_KIT_MANIFEST_SCHEMA_VERSION,
    pilotKitVersion: PILOT_KIT_VERSION,
    protocolVersion: PILOT_PROTOCOL_VERSION,
    consentVersion: PILOT_CONSENT_VERSION,
    sestinaRelease: {
      version: FIXTURE_RELEASE_VERSION,
      buildId: FIXTURE_RELEASE_BUILD_ID,
      artifactFile,
      artifactSha256,
    },
    files,
    security: {
      localOnly: true,
      noTelemetry: true,
      participantControlledExport: true,
      containsResearchContent: false,
      containsCredentials: false,
    },
  } as const;
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  writeFileSync(join(output, "pilot-kit-manifest.json"), manifestBytes);
  const sums = [
    ...files.map((file) => `${file.sha256}  ${file.path}`),
    `${sha256(manifestBytes)}  pilot-kit-manifest.json`,
  ].sort((left, right) => left.slice(66).localeCompare(right.slice(66), "en"));
  writeFileSync(join(output, "SHA256SUMS"), `${sums.join("\n")}\n`, "utf8");
}

async function buildPair() {
  const parent = await mkdtemp(join(tmpdir(), "sestina-pilot-kit-"));
  temporaryRoots.push(parent);
  const first = join(parent, "first kit");
  const second = join(parent, "第二个 kit");
  for (const output of [first, second]) {
    materializeFixtureKit(output);
  }
  return { parent, first, second };
}

describe("deterministic, tamper-evident Pilot Kit verifier", () => {
  it("accepts byte-identical self-contained fixtures with the same bound release", async () => {
    const { first, second } = await buildPair();
    expect(filesUnder(first)).toEqual(filesUnder(second));
    for (const relativePath of filesUnder(first)) {
      expect(readFileSync(join(first, relativePath))).toEqual(
        readFileSync(join(second, relativePath)),
      );
    }
    const verified = await verifyPilotKit(first);
    expect(verified.manifest.sestinaRelease.version).toBe("0.1.0");
    expect(verified.verifiedFiles).toContain("bin/sestina-pilot.mjs");
    expect(filesUnder(first).some((path) => path.endsWith(".map"))).toBe(false);
  }, 30_000);

  it.each([
    "bin/sestina-pilot.mjs",
    "schema/shareable-pilot-export.schema.json",
  ])("rejects tampering of %s", async (relativePath) => {
    const { first, parent } = await buildPair();
    const tampered = join(parent, `tampered-${relativePath.split("/")[0]}`);
    cpSync(first, tampered, { recursive: true });
    const target = join(tampered, relativePath);
    writeFileSync(target, Buffer.concat([readFileSync(target), Buffer.from("x")]));
    await expect(verifyPilotKit(tampered)).rejects.toThrowError(
      "pilot_kit_hash_mismatch",
    );
  }, 30_000);

  it("rejects a tampered release artifact and an extra file", async () => {
    const { first, parent } = await buildPair();
    const releaseTamper = join(parent, "release-tamper");
    cpSync(first, releaseTamper, { recursive: true });
    const manifest = JSON.parse(
      readFileSync(join(releaseTamper, "pilot-kit-manifest.json"), "utf8"),
    ) as { sestinaRelease: { artifactFile: string } };
    const artifact = join(
      releaseTamper,
      "release",
      manifest.sestinaRelease.artifactFile,
    );
    writeFileSync(artifact, Buffer.concat([readFileSync(artifact), Buffer.from("x")]));
    await expect(verifyPilotKit(releaseTamper)).rejects.toThrowError(
      "pilot_kit_hash_mismatch",
    );

    const extra = join(parent, "extra-file");
    cpSync(first, extra, { recursive: true });
    mkdirSync(dirname(join(extra, "unexpected", "data.txt")), { recursive: true });
    writeFileSync(join(extra, "unexpected", "data.txt"), "not allowed", "utf8");
    await expect(verifyPilotKit(extra)).rejects.toThrowError(
      "pilot_kit_extra_file",
    );
  }, 30_000);
});
