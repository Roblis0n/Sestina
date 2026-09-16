import { expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  assembleTargetRelease,
  inspectTargetRelease,
  verifyPublishedTargetRelease,
  assertPublishedInstallations,
} from "../../scripts/lib/target-verification.mjs";

const sha = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "sestina-release-contract-"));
  const keys = generateKeyPairSync("ed25519");
  const identity = {
    sourceCommit: "a".repeat(40),
    version: "0.3.0",
    publicTag: "v0.3.0",
    sourceTree: "b".repeat(40),
    lockSha256: "c".repeat(64),
    migrationSourceSha256: "d".repeat(64),
    schema: 25,
    channel: "stable",
    profile: "release",
    sequence: 1,
  };
  const packages = ["win32-x64", "darwin-arm64", "linux-x64"].map((target) => {
    const [platform, arch] = target.split("-") as [
      "win32" | "darwin" | "linux",
      string,
    ];
    const area = join(directory, target);
    mkdirSync(area);
    const extension = { win32: "exe", darwin: "dmg", linux: "AppImage" }[
      platform
    ];
    const name = `Sestina-0.3.0-${target}.${extension}`;
    const bytes = Buffer.from(
      `Synthetic ${target} bytes, not installation evidence`,
    );
    const core = Buffer.from(`Synthetic ${target} core`);
    const manifest = {
      ...identity,
      platform,
      arch,
      unsignedCoreSha256: sha(core),
      update: {
        source: `https://updates.example.org/${target}.json`,
        roots: {
          fixture: keys.publicKey
            .export({ type: "spki", format: "pem" })
            .toString(),
        },
      },
      envelope: {
        status: {
          win32: "authenticode_verified",
          darwin: "signed_notarized_verified",
          linux: "checksum_provenance",
        }[platform],
        files: [{ name, sha256: sha(bytes), size: bytes.length }],
      },
    };
    const payload = JSON.stringify({
      ...Object.fromEntries(
        [
          "version",
          "channel",
          "sequence",
          "platform",
          "arch",
          "schema",
          "sourceCommit",
          "migrationSourceSha256",
          "unsignedCoreSha256",
        ].map((key) => [key, (manifest as Record<string, unknown>)[key]]),
      ),
      format: "2.0.0",
      signed: true,
      sha256: sha(bytes),
      size: bytes.length,
      artifactPath: `/artifacts/${sha(bytes)}/Sestina.${extension}`,
    });
    writeFileSync(join(area, name), bytes);
    writeFileSync(join(area, "unsigned-core.tar.gz"), core);
    writeFileSync(
      join(area, "candidate-manifest.json"),
      JSON.stringify(manifest),
    );
    writeFileSync(
      join(area, "SHA256SUMS"),
      [name, "unsigned-core.tar.gz", "candidate-manifest.json"]
        .map((file) => `${sha(readFileSync(join(area, file)))}  ${file}`)
        .join("\n") + "\n",
    );
    writeFileSync(
      join(area, "offer.json"),
      JSON.stringify({
        payload,
        keyId: "fixture",
        signature: sign(null, Buffer.from(payload), keys.privateKey).toString(
          "base64",
        ),
      }),
    );
    return {
      target,
      manifest: join(area, "candidate-manifest.json"),
      installer: join(area, name),
      update: join(area, "offer.json"),
    };
  });
  return { directory, identity, packages };
}
it("assembles and checks all three package/source/checksum/update byte sets and rejects changed attachments", async () => {
  const f = fixture();
  try {
    const output = join(f.directory, "delivery");
    await assembleTargetRelease(f.packages, output);
    expect(
      (await inspectTargetRelease(output, f.identity)).targets.length,
    ).toBe(3);
    writeFileSync(join(output, "linux-x64-update.json"), "{}");
    await expect(inspectTargetRelease(output, f.identity)).rejects.toThrow();
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});
it("rejects mixed source, missing target, altered checksum and a signed offer pointing at another installer", async () => {
  for (const fault of ["source", "missing", "checksum", "offer"]) {
    const f = fixture();
    try {
      if (fault === "missing") f.packages.pop();
      const p = f.packages[0];
      if (fault === "source") {
        const m = JSON.parse(readFileSync(p.manifest, "utf8")) as Record<
          string,
          unknown
        >;
        m.sourceCommit = "f".repeat(40);
        writeFileSync(p.manifest, JSON.stringify(m));
      }
      if (fault === "checksum")
        writeFileSync(
          join(f.directory, p.target, "SHA256SUMS"),
          "0".repeat(64) + "  nonexistent.exe\n",
        );
      if (fault === "offer")
        writeFileSync(p.update, readFileSync(f.packages[1].update));
      await expect(
        assembleTargetRelease(f.packages, join(f.directory, "delivery")),
      ).rejects.toThrow();
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  }
});
it("downloads actual release attachments and fails on remote bytes even if the advertised digest matches", async () => {
  const f = fixture();
  try {
    const output = join(f.directory, "delivery");
    const index = await assembleTargetRelease(f.packages, output);
    const calls: string[][] = [];
    const runGh = (args: string[]) => {
      calls.push(args);
      if (args[0] === "api")
        return JSON.stringify({ sha: f.identity.sourceCommit });
      if (args[1] === "view")
        return JSON.stringify({
          tagName: f.identity.publicTag,
          isDraft: false,
          assets: [
            ...index.assets.map((a) => ({
              name: a.name,
              digest: `sha256:${a.sha256}`,
            })),
            { name: "release-index.json" },
            { name: "SHA256SUMS" },
          ],
        });
      const dest = args[args.indexOf("--dir") + 1];
      for (let n = 0; n < args.length; n++)
        if (args[n] === "--pattern")
          writeFileSync(
            join(dest, args[n + 1]),
            readFileSync(join(output, args[n + 1])),
          );
      writeFileSync(
        join(dest, index.assets[0].name),
        "remote substituted bytes",
      );
      return "";
    };
    await expect(
      verifyPublishedTargetRelease({
        directory: output,
        repository: "fixture/repo",
        identity: f.identity,
        output: join(f.directory, "remote"),
        runGh,
      }),
    ).rejects.toThrow();
    expect(calls.some((call) => call[1] === "download")).toBe(true);
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});

it("accepts matching downloaded bytes and rejects missing attachments or a moved remote tag", async () => {
  const f = fixture();
  try {
    const output = join(f.directory, "delivery");
    const index = await assembleTargetRelease(f.packages, output);
    let fault = "";
    const runGh = (args: string[]) => {
      if (args[0] === "api")
        return JSON.stringify({
          sha: fault === "tag" ? "f".repeat(40) : f.identity.sourceCommit,
        });
      if (args[1] === "view")
        return JSON.stringify({
          tagName: f.identity.publicTag,
          isDraft: false,
          assets: [
            ...index.assets
              .filter((_, i) => fault !== "missing" || i !== 0)
              .map((a) => ({ name: a.name })),
            { name: "release-index.json" },
            { name: "SHA256SUMS" },
          ],
        });
      const dest = args[args.indexOf("--dir") + 1];
      for (let n = 0; n < args.length; n++)
        if (args[n] === "--pattern")
          writeFileSync(
            join(dest, args[n + 1]),
            readFileSync(join(output, args[n + 1])),
          );
      return "";
    };
    const verify = () =>
      verifyPublishedTargetRelease({
        directory: output,
        repository: "fixture/repo",
        identity: f.identity,
        output: join(f.directory, `remote-${fault || "good"}`),
        runGh,
      });
    expect((await verify()).passed).toBe(true);
    fault = "missing";
    await expect(verify()).rejects.toThrow("publication_attachment_missing");
    fault = "tag";
    await expect(verify()).rejects.toThrow("publication_remote_tag_mismatch");
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});

it("published installation acceptance requires bound download, actual install, artifact and reopen proofs", async () => {
  const f = fixture();
  try {
    const index = await assembleTargetRelease(
      f.packages,
      join(f.directory, "delivery"),
    );
    const records = index.targets.map((target) => {
      const [platform, arch] = target.split("-");
      const installer = index.assets.find(
        (asset) => asset.target === target && asset.role === "installer",
      );
      if (!installer) throw Error("fixture_installer_missing");
      const installed = `synthetic/${target}`;
      const identity = {
        sourceCommit: index.sourceCommit,
        platform,
        arch,
        installerSha256: installer.sha256,
      };
      const dir = join(f.directory, target);
      const proofs = {
        download: {
          passed: true,
          sourceCommit: index.sourceCommit,
          repository: "fixture/repo",
          tag: index.publicTag,
          assets: [installer],
        },
        installation: { ...identity, installed, kind: "actual_installer" },
        artifact: { passed: true, identity, installedDirectory: installed },
        journeys: {
          passed: true,
          identity,
          cases: ["offline-decision-restart-views"],
        },
      };
      const evidence = Object.entries(proofs).map(([role, value]) => {
        const name = `${role}-proof.json`;
        writeFileSync(join(dir, name), JSON.stringify(value));
        return { role, path: name, sha256: sha(readFileSync(join(dir, name))) };
      });
      return {
        path: join(dir, "record.json"),
        result: {
          ...identity,
          passed: true,
          installed,
          repository: "fixture/repo",
          tag: index.publicTag,
          origin: "github_release_download",
          cases: [
            "downloaded-package-installed",
            "installed-artifact-verified",
            "project-open-quit-reopen",
          ],
          evidence,
        },
      };
    });
    await expect(
      assertPublishedInstallations(records, index, "fixture/repo"),
    ).resolves.toBeUndefined();
    await expect(
      assertPublishedInstallations(records.slice(1), index, "fixture/repo"),
    ).rejects.toThrow("published_native_installations_required");
    records[0].result.origin = "local_same_name";
    await expect(
      assertPublishedInstallations(records, index, "fixture/repo"),
    ).rejects.toThrow("published_installation_identity_mismatch");
    records[0].result.origin = "github_release_download";
    writeFileSync(
      join(f.directory, index.targets[0], "journeys-proof.json"),
      "{}",
    );
    await expect(
      assertPublishedInstallations(records, index, "fixture/repo"),
    ).rejects.toThrow("published_installation_evidence_changed");
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});
