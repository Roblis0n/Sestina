import { execFileSync } from "node:child_process";
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
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { verifyPilotKit } from "../src/index.js";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../../..");
const BUILD_SCRIPT = join(REPOSITORY_ROOT, "scripts", "build-pilot-kit.mjs");
const RELEASE_ROOT = join(REPOSITORY_ROOT, "release");
const temporaryRoots: string[] = [];

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

async function buildPair() {
  const parent = await mkdtemp(join(tmpdir(), "sestina-pilot-kit-"));
  temporaryRoots.push(parent);
  const first = join(parent, "first kit");
  const second = join(parent, "第二个 kit");
  for (const output of [first, second]) {
    execFileSync(process.execPath, [BUILD_SCRIPT, RELEASE_ROOT, output], {
      cwd: REPOSITORY_ROOT,
      stdio: "pipe",
      windowsHide: true,
    });
  }
  return { parent, first, second };
}

describe("deterministic, tamper-evident Pilot Kit", () => {
  it("builds byte-identical kits from the same verified release", async () => {
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
