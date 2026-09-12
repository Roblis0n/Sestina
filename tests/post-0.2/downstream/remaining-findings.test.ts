import { it, expect } from "vitest";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { SESTINA_RELEASE_IDENTITY as identity } from "../../../packages/schema/src/release-contract.mjs";
import { validateReleaseManifest } from "../../../scripts/lib/release-verifier.mjs";
it("P2-02 G10/G12: production package declares a bundled Electron application entry", async () => {
  const pkg = JSON.parse(
    await readFile("apps/desktop/package.json", "utf8").catch((error) => {
      if (error.code === "ENOENT") return "{}";
      throw error;
    }),
  );
  // G10 owns apps/desktop. Absence is an explicit behavioral RED, never a skip
  // or a request to add Electron to the published browser-preview package.
  expect({
    main: pkg.main ?? null,
    electron:
      pkg.dependencies?.electron ?? pkg.devDependencies?.electron ?? null,
  }).toMatchObject({ main: expect.any(String), electron: expect.any(String) });
});
it("P2-02 G10/G12: the release tag verifier refuses a valid manifest from an unrelated source commit", async () => {
  const directory = await mkdtemp(
      join(tmpdir(), "sestina-g1-release-negative-"),
    ),
    root = `sestina-research-room-${identity.version}-windows-x64`;
  const paths = [
    `${root}/app/main.js`,
    `${root}/app/mcp/main.js`,
    `${root}/start.mjs`,
  ];
  const manifest = {
    schemaVersion: "3.0.0",
    identity,
    platform: {
      os: "win32",
      architecture: "x64",
      nativeSecretBackend: "windows-dpapi-current-user",
    },
    source: { gitCommit: "a4889ee996064d95ee0a3fb470ee6ee12d3a91a3" },
    distribution: {
      license: "Apache-2.0",
      repository: "https://github.com/Roblis0n/Sestina",
      tag: "v0.2.0",
      releaseUrl: "https://github.com/Roblis0n/Sestina/releases/tag/v0.2.0",
      platformSlug: "windows-x64",
      primaryArtifact: `${root}.zip`,
    },
    compatibility: {
      nodeRange: identity.nodeRange,
      supportedSchemaMinimum: identity.supportedSchemaMinimum,
      supportedSchemaMaximum: identity.databaseSchemaVersion,
      futureSchemaPolicy: identity.futureSchemaPolicy,
      downgradeSupported: identity.downgradeSupported,
    },
    contents: {
      releaseBundleRoot: root,
      releaseBundlePaths: paths,
      executablePaths: paths,
    },
    security: {
      bindAddress: "127.0.0.1",
      localOnly: true,
      offlineCapable: true,
      telemetry: false,
      crashUpload: false,
      backgroundLogging: false,
      networkUpload: false,
      updateCheck: false,
      postinstall: false,
      containsSourceMaps: false,
      containsResearchData: false,
      containsCredentials: false,
      uninstallDeletesProjectData: false,
      npmPublished: false,
    },
    artifacts: [
      {
        file: `${root}.tar.gz`,
        kind: "platform-tar-gzip",
        sha256: "c".repeat(64),
        size: 1,
      },
      {
        file: `${root}.zip`,
        kind: "platform-zip",
        sha256: "d".repeat(64),
        size: 1,
      },
    ],
  };
  try {
    expect(() => {
      validateReleaseManifest(manifest);
    }).not.toThrow();
    await writeFile(
      join(directory, "release-manifest.json"),
      JSON.stringify(manifest),
    );
    const checked = spawnSync(
      process.execPath,
      [resolve("scripts/verify-release-tag.mjs"), "v0.2.0", directory],
      { windowsHide: true, encoding: "utf8" },
    );
    expect(checked.error).toBeUndefined();
    expect(checked.status).toBe(1);
    expect(checked.stderr).toContain("release_tag_source_mismatch");
    const tagCommit = execFileSync("git", ["rev-parse", "refs/tags/v0.2.0^{commit}"], { encoding: "utf8", windowsHide: true }).trim();
    await writeFile(join(directory, "release-manifest.json"), JSON.stringify({ ...manifest, source: { gitCommit: tagCommit } }));
    const valid = spawnSync(process.execPath, [resolve("scripts/verify-release-tag.mjs"), "v0.2.0", directory], { windowsHide: true, encoding: "utf8" });
    expect(valid.status, valid.stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
