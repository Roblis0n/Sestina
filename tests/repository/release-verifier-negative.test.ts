import { describe, expect, it } from "vitest";
import { SESTINA_RELEASE_IDENTITY } from "../../packages/schema/src/release-contract.mjs";
import {
  parseChecksums,
  scanReleaseEntries,
  validateReleaseManifest,
  verifyReleaseBundleEntries,
} from "../../scripts/lib/release-verifier.mjs";

const identity = SESTINA_RELEASE_IDENTITY;
const platform = { os: "win32", architecture: "x64", nativeSecretBackend: "windows-dpapi-current-user" } as const;
const root = `sestina-research-room-${identity.version}-windows-x64`;
const requiredPaths = [
  `${root}/LICENSE`,
  `${root}/README.md`,
  `${root}/RELEASE-IDENTITY.json`,
  `${root}/app/client/assets/app.css`,
  `${root}/app/client/assets/app.js`,
  `${root}/app/client/index.html`,
  `${root}/app/main.js`,
  `${root}/app/mcp/main.js`,
  `${root}/app/mcp/runtime.js`,
  `${root}/app/server.js`,
  `${root}/docs/INSTALL-LINUX.md`,
  `${root}/docs/INSTALL-MACOS.md`,
  `${root}/docs/INSTALL-WINDOWS.md`,
  `${root}/docs/RECOVERY-AND-UPGRADE.md`,
  `${root}/docs/RELEASE-NOTES.md`,
  `${root}/docs/SECURITY.md`,
  `${root}/docs/SUPPORT.md`,
  `${root}/docs/THIRD-PARTY-NOTICES.md`,
  `${root}/node_modules/@primno/dpapi/package.json`,
  `${root}/node_modules/@primno/dpapi/prebuilds/win32-x64/@primno+dpapi.node`,
  `${root}/node_modules/node-gyp-build/node-gyp-build.js`,
  `${root}/package.json`,
  `${root}/start.mjs`,
].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));

const packageJson = {
  name: identity.package,
  version: identity.version,
  private: true,
  description: "Sestina Research Room 0.2 public preview",
  license: "Apache-2.0",
  type: "module",
  engines: { node: identity.nodeRange },
  scripts: { start: "node start.mjs" },
};

function releaseIdentity() {
  return { ...identity, platform: platform.os, architecture: platform.architecture, nativeSecretBackend: platform.nativeSecretBackend };
}

function dataFor(path: string, packageOverride = packageJson): Buffer {
  if (path.endsWith("/package.json") && path === `${root}/package.json`) return Buffer.from(JSON.stringify(packageOverride));
  if (path.endsWith("/RELEASE-IDENTITY.json")) return Buffer.from(JSON.stringify(releaseIdentity()));
  return Buffer.from(path.endsWith(".node") ? [0, 1, 2, 3] : "safe");
}

function entries(packageOverride = packageJson, paths = requiredPaths) {
  return paths.map((path) => ({
    path,
    mode: [`${root}/start.mjs`, `${root}/app/main.js`, `${root}/app/mcp/main.js`].includes(path) ? 0o755 : 0o644,
    data: dataFor(path, packageOverride),
  }));
}

function manifest(paths = requiredPaths) {
  return {
    schemaVersion: "3.0.0",
    identity,
    platform,
    source: { gitCommit: "b".repeat(40) },
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
      executablePaths: [`${root}/app/main.js`, `${root}/app/mcp/main.js`, `${root}/start.mjs`],
    },
    security: {
      bindAddress: "127.0.0.1", localOnly: true, offlineCapable: true, telemetry: false, crashUpload: false,
      backgroundLogging: false, networkUpload: false, updateCheck: false, postinstall: false, containsSourceMaps: false,
      containsResearchData: false, containsCredentials: false, uninstallDeletesProjectData: false, npmPublished: false,
    },
    artifacts: [
      { file: `${root}.tar.gz`, kind: "platform-tar-gzip", sha256: "c".repeat(64), size: 1 },
      { file: `${root}.zip`, kind: "platform-zip", sha256: "d".repeat(64), size: 1 },
    ],
  };
}

describe("RI-54 release verifier fail-closed negative fixtures", () => {
  it("rejects manifest-version and checksum tampering", () => {
    expect(() => { validateReleaseManifest({ ...manifest(), schemaVersion: "1.0.0" }); }).toThrow(/release_manifest_version_invalid/u);
    expect(() => parseChecksums(`${"0".repeat(63)}x  release-manifest.json\n`)).toThrow(/sha256sums_format_invalid/u);
  });

  it("rejects dependency injection, a broken launcher, and missing co-located MCP", () => {
    expect(() => { verifyReleaseBundleEntries(entries({ ...packageJson, dependencies: { "@sestina/core": "workspace:*" } }), manifest()); }).toThrow(/release_package_manifest_keys_invalid/u);
    expect(() => { verifyReleaseBundleEntries(entries({ ...packageJson, scripts: { start: "node src/main.ts" } }), manifest()); }).toThrow(/release_package_identity_invalid/u);
    const withoutMcp = requiredPaths.filter((path) => path !== `${root}/app/mcp/main.js`);
    expect(() => { verifyReleaseBundleEntries(entries(packageJson, withoutMcp), manifest(withoutMcp)); }).toThrow(/release_bundle_runtime_missing/u);
  });

  it("rejects source maps, development fixtures, secrets, current Brief state, and databases", () => {
    expect(() => { scanReleaseEntries([{ path: `${root}/app/main.js.map`, data: Buffer.from("map") }]); }).toThrow(/forbidden_release_path/u);
    expect(() => { scanReleaseEntries([{ path: `${root}/tests/fixture.ts`, data: Buffer.from("fixture") }]); }).toThrow(/forbidden_release_path/u);
    expect(() => { scanReleaseEntries([{ path: `${root}/README.md`, data: Buffer.from("SESTINA_SYNTHETIC_SECRET_DO_NOT_SHIP") }]); }).toThrow(/forbidden_release_content/u);
    expect(() => { scanReleaseEntries([{ path: `${root}/.sestina/research-brief.yaml`, data: Buffer.from("private") }]); }).toThrow(/forbidden_release_path/u);
    expect(() => { scanReleaseEntries([{ path: `${root}/state.sqlite`, data: Buffer.from("SQLite") }]); }).toThrow(/forbidden_release_path/u);
  });
});
