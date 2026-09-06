import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const node = process.execPath;
const eslint = resolve(root, "node_modules/eslint/bin/eslint.js");
const tsc = resolve(root, "node_modules/typescript/bin/tsc");
const vitest = resolve(root, "node_modules/vitest/vitest.mjs");

function runNode(label, args) {
  process.stdout.write(`\n[public shared] ${label}\n`);
  const result = spawnSync(node, args, {
    cwd: root,
    env: { ...process.env, CI: "true", NO_COLOR: "1" },
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    process.stderr.write(`[public shared] failed: ${label}\n`);
    process.exit(result.status ?? 1);
  }
}

function run(label, entry, args = []) {
  runNode(label, [entry, ...args]);
}

run("production-source lint", eslint, [
  "apps/cli/src/main.ts",
  "apps/research-room/src/main.ts",
  "apps/research-room/src/server.ts",
  "apps/research-room/client/src",
  "packages/core/src",
  "packages/research/src",
  "packages/research-store/src",
  "packages/storage/src",
  "packages/pilot/src",
  "packages/schema/src",
  "--max-warnings",
  "0",
]);

for (const project of [
  "packages/schema/tsconfig.json",
  "packages/storage/tsconfig.json",
  "packages/research/tsconfig.json",
  "packages/research-store/tsconfig.json",
  "packages/secrets/tsconfig.json",
  "packages/core/tsconfig.json",
  "packages/pilot/tsconfig.json",
  "apps/research-room/tsconfig.json",
  "apps/research-room/client/tsconfig.json",
]) {
  run(`typecheck ${project}`, tsc, ["--noEmit", "-p", project]);
}

run("public-preview, resilience, privacy, and authority tests", vitest, [
  "run",
  "--project",
  "unit",
  "packages/schema/test/release-contract.test.ts",
  "packages/core/test/release-identity.test.ts",
  "packages/core/test/recovery.test.ts",
  "packages/storage/test/backup.test.ts",
  "packages/storage/test/migrations.test.ts",
  "packages/storage/test/migration-016.test.ts",
  "packages/storage/test/migration-017.test.ts",
  "packages/storage/test/migrations-018.test.ts",
  "packages/storage/test/migration-019.test.ts",
  "packages/storage/test/migration-020.test.ts",
  "packages/secrets/test",
  "packages/pilot/test",
  "apps/cli/test/version.test.ts",
  "apps/research-room/test/api-boundary.test.ts",
  "apps/research-room/test/client-assets.test.ts",
  "apps/research-room/test/production-entry.test.ts",
  "apps/research-room/test/provider-settings.test.ts",
  "apps/research-room/test/server.test.ts",
  "apps/research-room/test/ri53-api.test.ts",
  "apps/research-room/test/ri53-responsive-chrome.test.ts",
  "tests/repository/public-preview-contract.test.ts",
  "tests/repository/release-archive.test.ts",
  "tests/repository/release-artifact-contract.test.ts",
  "tests/repository/release-verifier-negative.test.ts",
  "--maxWorkers=1",
  "--no-file-parallelism",
]);

run("G0 frozen contracts", resolve(root, "scripts/verify-post-0.2-contracts.mjs"));
run("Pinned legacy source and recipe provenance", resolve(root, "scripts/verify-post-0.2-toolchain.mjs"));
run("G1 downstream discovery and immutable corpus declarations", resolve(root, "scripts/verify-post-0.2-discovery.mjs"));
run("Schema 021–025 deterministic structure", resolve(root, "scripts/verify-post-0.2-schema.mjs"));
run("G1–G3 foundation regression (downstream RED contracts have independent commands)", vitest, ["run", "--config", "tests/post-0.2/vitest.foundation.config.ts"]);

for (const script of [
  "scripts/build-release.mjs",
  "scripts/build-pilot-kit.mjs",
  "scripts/package-pilot-kit.mjs",
  "scripts/assemble-public-release.mjs",
  "scripts/verify-public-release.mjs",
  "scripts/lib/release-verifier.mjs",
  "scripts/lib/public-release-verifier.mjs",
  "scripts/run-fresh-install.mjs",
  "scripts/run-public-platform-gates.mjs",
  "scripts/prepare-release-lifecycle-fixture.mjs",
  "scripts/audit-public-history.mjs",
  "scripts/verify-public-repository.mjs",
]) {
  runNode(`syntax ${script}`, ["--check", resolve(root, script)]);
}

for (const script of [
  "scripts/verify-public-repository.mjs",
  "scripts/check-doc-links.mjs",
  "scripts/check-repository-shape.mjs",
  "scripts/verify-architecture.mjs",
  "scripts/audit-public-history.mjs",
]) {
  run(script, resolve(root, script));
}

process.stdout.write(
  "\n[public shared] all deterministic public gates passed\n",
);
