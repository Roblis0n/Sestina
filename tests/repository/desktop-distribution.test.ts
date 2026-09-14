import { expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  desktopDistribution,
  desktopExecutable,
} from "../../scripts/lib/desktop-distribution.mjs";

const source = "a".repeat(40);
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
