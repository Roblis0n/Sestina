import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, resolve, normalize } from "node:path";
const root = resolve(import.meta.dirname, "..");
const desktopRequire = createRequire(join(root, "apps/desktop/package.json"));
const builderRequire = createRequire(
  desktopRequire.resolve("electron-builder"),
);
const appBuilderRequire = createRequire(
  builderRequire.resolve("app-builder-lib"),
);
const asar = appBuilderRequire("@electron/asar");
const directory = resolve(
  process.argv[2] ?? "release/desktop/win32-x64/win-unpacked",
);
const manifestPath = resolve(
  process.argv[3] ?? "release/desktop/win32-x64/candidate-manifest.json",
);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const archive = join(directory, "resources/app.asar");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = JSON.parse(
  asar.extractFile(archive, "dist/identity.json").toString("utf8"),
);
for (const key of [
  "sourceCommit",
  "sourceTree",
  "lockSha256",
  "electron",
  "schema",
  "platform",
  "arch",
  "logoSha256",
  "version",
  "channel",
  "buildNode",
  "packageManager",
  "buildCommand",
  "migrationSourceSha256",
])
  if (identity[key] !== manifest[key])
    throw new Error(`desktop_identity_mismatch:${key}`);
if (
  identity.channel !== "internal_candidate" ||
  identity.signed !== false ||
  !/^[a-f0-9]{40}$/.test(identity.sourceCommit)
)
  throw new Error("candidate_identity_invalid");
const git = (...args) => execFileSync("git", args, { cwd: root, windowsHide: true });
const expectedSource = process.argv[4] ?? git("rev-parse", "HEAD").toString().trim();
if (identity.sourceCommit !== expectedSource) throw new Error("desktop_expected_source_mismatch");
if (identity.sourceTree !== git("rev-parse", `${expectedSource}^{tree}`).toString().trim()) throw new Error("desktop_source_tree_mismatch");
for (const [field, path] of [["lockSha256", "pnpm-lock.yaml"], ["migrationSourceSha256", "packages/storage/src/kernel-schema.ts"], ["logoSha256", "apps/research-room/client/public/sestina-logo.png"]]) {
  if (identity[field] !== sha(git("show", `${expectedSource}:${path}`))) throw new Error(`desktop_source_content_mismatch:${field}`);
}
if (JSON.parse(asar.extractFile(archive, "package.json").toString()).version !== identity.version) throw new Error("desktop_package_version_mismatch");
if (identity.platform === "win32") {
  const binary = await readFile(join(directory, "Sestina Candidate.exe"));
  if (binary.toString("ascii", 0, 2) !== "MZ" || binary.readUInt16LE(binary.readUInt32LE(0x3c) + 4) !== 0x8664 || identity.arch !== "x64") throw new Error("desktop_binary_target_mismatch");
}
const expected = new Set(manifest.files.map((file) => "/" + file.path));
for (const file of manifest.files) {
  if (
    !/^(?:dist\/(?:main\.cjs|preload\.cjs|assets\.json|identity\.json|client\/(?:index\.html|sestina-logo\.png|assets\/[a-zA-Z0-9_.-]+))|package\.json|LICENSE|THIRD-PARTY-NOTICES\.md)$/.test(
      file.path,
    )
  )
    throw new Error("desktop_unapproved_content");
  const bytes = asar.extractFile(archive, normalize(file.path));
  if (bytes.length !== file.size || sha(bytes) !== file.sha256)
    throw new Error(`desktop_content_mismatch:${file.path}`);
}
for (const name of asar
  .listPackage(archive)
  .map((name) => name.replaceAll("\\", "/"))) {
  const info = asar.statFile(archive, normalize(name.replace(/^\//, "")));
  if (!info.files && !expected.has(name))
    throw new Error(`desktop_unlisted_content:${name}`);
}
if (
  sha(asar.extractFile(archive, normalize("dist/client/sestina-logo.png"))) !==
  manifest.logoSha256
)
  throw new Error("desktop_logo_mismatch");
console.log(
  JSON.stringify({
    passed: true,
    installedDirectory: directory,
    identity,
    verifiedFiles: expected.size,
  }),
);
