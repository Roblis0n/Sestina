import { describe, expect, it } from "vitest";
import {
  parseChecksums,
  scanReleaseEntries,
  validateReleaseManifest,
  verifyNpmPackageEntries,
} from "../../scripts/lib/release-verifier.mjs";

const identity = {
  schemaVersion: "1.0.0", package: "@sestina/cli", version: "0.1.0", nodeRange: ">=24 <25",
  runtimeVersion: "0.1.0", reportSchemaVersion: "1.0.0", capsuleResponseSchemaVersion: "1.0.0",
  mcpServerVersion: "0.1.0", mcpResearchContextSchemaVersion: "1.1", checkerBuildContract: "deterministic-review-v1",
  databaseSchemaVersion: 15, migrationManifestVersion: "1.0.0", migrationCount: 15, releaseBuildId: "a".repeat(64),
};

const packageJson = {
  name: "@sestina/cli", version: "0.1.0", private: true, description: "test", license: "UNLICENSED", type: "module",
  bin: { sestina: "./dist/main.js" }, main: "./dist/cli.js", exports: { ".": "./dist/cli.js", "./package.json": "./package.json" },
  engines: { node: ">=24 <25" }, files: ["dist/", "README.md"],
};
const paths = [
  "package/README.md", "package/dist/cli.js", "package/dist/main.js", "package/dist/mcp/index.js",
  "package/dist/mcp/main.js", "package/dist/mcp/runtime.js", "package/package.json",
].sort();
const manifest = {
  schemaVersion: "1.0.0", identity, source: { gitCommit: "b".repeat(40) },
  contents: { npmPackagePaths: paths, releaseBundlePaths: ["sestina-0.1.0/README.md"] },
  security: { localOnly: true, offlineCapable: true, telemetry: false, crashUpload: false, backgroundLogging: false, networkUpload: false, postinstall: false, containsResearchData: false, containsCredentials: false, uninstallDeletesProjectData: false, npmPublished: false },
  artifacts: [
    { file: "sestina-0.1.0.tar.gz", kind: "portable-tar-gzip", sha256: "c".repeat(64), size: 1 },
    { file: "sestina-0.1.0.zip", kind: "portable-zip", sha256: "d".repeat(64), size: 1 },
    { file: "sestina-cli-0.1.0.tgz", kind: "npm-tarball", sha256: "e".repeat(64), size: 1 },
  ],
};
function entries(overrides = packageJson) {
  return paths.map((path) => ({ path, mode: path.endsWith("main.js") ? 0o755 : 0o644, data: Buffer.from(path === "package/package.json" ? JSON.stringify(overrides) : "safe") }));
}

describe("release verifier fail-closed negative fixtures", () => {
  it("rejects manifest-version and checksum tampering", () => {
    expect(() => { validateReleaseManifest({ ...manifest, schemaVersion: "2.0.0" }); }).toThrow(/release_manifest_version_invalid/u);
    expect(() => parseChecksums(`${"0".repeat(63)}x  release-manifest.json\n`)).toThrow(/sha256sums_format_invalid/u);
  });

  it("rejects workspace dependencies, a broken bin, and missing co-located MCP", () => {
    expect(() => { verifyNpmPackageEntries(entries({ ...packageJson, dependencies: { "@sestina/core": "workspace:*" } }), manifest); }).toThrow(/npm_package_manifest_keys_invalid/u);
    expect(() => { verifyNpmPackageEntries(entries({ ...packageJson, bin: { sestina: "./src/main.ts" } }), manifest); }).toThrow(/npm_package_runtime_paths_invalid/u);
    expect(() => { verifyNpmPackageEntries(entries().filter((entry) => entry.path !== "package/dist/mcp/main.js"), { ...manifest, contents: { ...manifest.contents, npmPackagePaths: paths.filter((path) => path !== "package/dist/mcp/main.js") } }); }).toThrow(/npm_package_runtime_missing/u);
  });

  it("rejects development fixtures, synthetic secrets, current Brief state, and databases", () => {
    const withFixture = [...entries(), { path: "package/src/fixture.ts", mode: 0o644, data: Buffer.from("fixture") }];
    expect(() => { verifyNpmPackageEntries(withFixture, { ...manifest, contents: { ...manifest.contents, npmPackagePaths: [...paths, "package/src/fixture.ts"].sort() } }); }).toThrow(/npm_package_contains_development_files/u);
    expect(() => { scanReleaseEntries([{ path: "bundle/README.md", data: Buffer.from("SESTINA_SYNTHETIC_SECRET_DO_NOT_SHIP") }]); }).toThrow(/forbidden_release_content/u);
    expect(() => { scanReleaseEntries([{ path: "bundle/.sestina/research-brief.yaml", data: Buffer.from("private") }]); }).toThrow(/forbidden_release_path/u);
    expect(() => { scanReleaseEntries([{ path: "bundle/state.sqlite", data: Buffer.from("SQLite") }]); }).toThrow(/forbidden_release_path/u);
  });
});
