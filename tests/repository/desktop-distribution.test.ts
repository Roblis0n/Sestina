import { expect, it } from "vitest";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  desktopDistribution,
  desktopExecutable,
} from "../../scripts/lib/desktop-distribution.mjs";

const source = "a".repeat(40);
it("production update signing binds actual bytes and refuses changed bytes or a different key", () => {
  const parent = resolve(".tmp/update-signing-tests");
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, "isolated-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: directory,
      windowsHide: true,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  try {
    git("init", "--initial-branch=fixture");
    git(
      "-c",
      "user.name=Synthetic fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "Synthetic release signing fixture",
    );
    git("tag", "v0.3.0");
    const commit = git("rev-parse", "HEAD");
    const keys = generateKeyPairSync("ed25519");
    const installer = join(directory, "synthetic.AppImage");
    const bytes = Buffer.from(
      "synthetic installer bytes, not a platform installation",
    );
    writeFileSync(installer, bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const manifest = join(directory, "manifest.json");
    writeFileSync(
      manifest,
      JSON.stringify({
        profile: "release",
        channel: "stable",
        version: "0.3.0",
        publicTag: "v0.3.0",
        sourceCommit: commit,
        platform: "linux",
        arch: "x64",
        sequence: 1,
        schema: 25,
        migrationSourceSha256: "a".repeat(64),
        unsignedCoreSha256: "b".repeat(64),
        update: {
          roots: {
            fixture: keys.publicKey.export({ type: "spki", format: "pem" }),
          },
        },
        envelope: {
          status: "checksum_provenance",
          files: [{ sha256, size: bytes.length }],
        },
      }),
    );
    const key = join(directory, "synthetic-key.pem");
    writeFileSync(
      key,
      keys.privateKey.export({ type: "pkcs8", format: "pem" }),
    );
    const sign = (output: string) =>
      execFileSync(
        process.execPath,
        [
          resolve("scripts/sign-desktop-update.mjs"),
          "--manifest",
          manifest,
          "--installer",
          installer,
          "--private-key",
          key,
          "--key-id",
          "fixture",
          "--output",
          join(directory, output),
        ],
        { cwd: directory, windowsHide: true, stdio: "pipe" },
      );
    sign("valid");
    const signed = JSON.parse(
      readFileSync(join(directory, "valid/linux-x64.json"), "utf8"),
    );
    expect(
      verify(
        null,
        Buffer.from(signed.payload),
        keys.publicKey,
        Buffer.from(signed.signature, "base64"),
      ),
    ).toBe(true);
    const payload = JSON.parse(signed.payload);
    expect(payload).toMatchObject({
      format: "2.0.0",
      sha256,
      size: bytes.length,
      sourceCommit: commit,
      platform: "linux",
      arch: "x64",
      schema: 25,
    });
    expect(
      readFileSync(join(directory, "valid", payload.artifactPath)),
    ).toEqual(bytes);
    writeFileSync(installer, "changed installer");
    expect(() => sign("changed")).toThrow(/update_installer_mismatch/);
    writeFileSync(installer, bytes);
    writeFileSync(
      key,
      generateKeyPairSync("ed25519").privateKey.export({
        type: "pkcs8",
        format: "pem",
      }),
    );
    expect(() => sign("wrong-key")).toThrow(/update_signer_not_installed_root/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
it("one product identity survives candidate to release while candidate trust remains empty", () => {
  const value = desktopDistribution({
    sourceCommit: source,
    target: "win32",
    version: "0.3.0",
  });
  expect(value.productName).toBe("Sestina");
  expect(value.appId).toBe("org.sestina.desktop");
  expect(value.version).toBe("0.3.0-g10.aaaaaaaa");
  expect(value.update).toEqual({ roots: {} });
  expect(value.storageName).toBe("Sestina Candidate");
  expect(desktopExecutable(value, "win32")).toBe("Sestina.exe");
  expect(desktopExecutable({}, "win32")).toBe("Sestina Candidate.exe");
});
it("release fails without exact tag, stable version, explicit authorized signing and production trust", () => {
  const base = {
    sourceCommit: source,
    target: "win32",
    version: "0.3.0",
    profile: "release",
  };
  expect(() => desktopDistribution(base)).toThrow("release_tag_required");
  expect(() =>
    desktopDistribution({ ...base, tag: "v0.3.0", tagCommit: "b".repeat(40) }),
  ).toThrow("release_tag_source_mismatch");
  expect(() =>
    desktopDistribution({ ...base, tag: "v0.3.0", tagCommit: source }),
  ).toThrow("release_update_configuration_required");
  expect(() => desktopDistribution({ ...base, version: "0.3.0-rc.1" })).toThrow(
    "desktop_version_invalid",
  );
});
it("production config rejects unsafe endpoints, private roots, ambiguous signers and cross target identity", () => {
  const keys = generateKeyPairSync("ed25519");
  const roots = {
    production: keys.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
  };
  const base = {
    sourceCommit: source,
    target: "win32",
    version: "0.3.0",
    profile: "release",
    tag: "v0.3.0",
    tagCommit: source,
  };
  const update = { source: "https://updates.example.org/stable.json", roots };
  expect(() => desktopDistribution({ ...base, config: { update } })).toThrow(
    "release_signing_configuration_required",
  );
  const signing = {
    target: "win32",
    certificateFile: "explicit.pfx",
    certificateSha256: "b".repeat(64),
    publisherName: "Synthetic Publisher",
    thumbprint: "c".repeat(40),
    passwordEnv: "SESTINA_SIGNING_PASSWORD",
  };
  const config = { update, signing };
  const value = desktopDistribution({ ...base, config });
  expect(value.channel).toBe("stable");
  expect(value.appId).toBe("org.sestina.desktop");
  for (const source of [
    "http://updates.example.org/feed",
    "https://127.0.0.1/feed",
    "https://u:p@updates.example.org/feed",
    "https://updates.example.org/feed?token=secret",
  ]) {
    expect(() =>
      desktopDistribution({
        ...base,
        config: { ...config, update: { ...update, source } },
      }),
    ).toThrow("release_update_source_invalid");
  }
  expect(() =>
    desktopDistribution({
      ...base,
      config: { ...config, signing: { ...signing, target: "darwin" } },
    }),
  ).toThrow("release_signing_configuration_required");
  expect(() =>
    desktopDistribution({
      ...base,
      config: {
        ...config,
        update: {
          ...update,
          roots: {
            production: keys.privateKey
              .export({ type: "pkcs8", format: "pem" })
              .toString(),
          },
        },
      },
    }),
  ).toThrow("release_update_root_invalid");
});
