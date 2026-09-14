import { createRequire } from "node:module";
import { readFile, readdir, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, resolve, normalize } from "node:path";
import { desktopExecutable } from "./lib/desktop-distribution.mjs";
import {
  desktopResources,
  assertDesktopBinary,
} from "./lib/target-verification.mjs";
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
const resources = desktopResources(directory, manifest.platform);
const archive = join(resources, "app.asar");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = JSON.parse(
  asar.extractFile(archive, "dist/identity.json").toString("utf8"),
);
for (const key of [
  "sourceCommit",
  "sequence",
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
  "productName",
  "appId",
  "executableName",
  "storageName",
  "profile",
  "baseVersion",
  "publicTag",
])
  if (identity[key] !== manifest[key])
    throw new Error(`desktop_identity_mismatch:${key}`);
if (
  !["internal_candidate", "stable"].includes(identity.channel) ||
  identity.signed !== false ||
  !/^[a-f0-9]{40}$/.test(identity.sourceCommit)
)
  throw new Error("candidate_identity_invalid");
if (JSON.stringify(identity.update) !== JSON.stringify(manifest.update))
  throw Error("desktop_update_identity_mismatch");
if (
  identity.profile &&
  (identity.productName !== "Sestina" ||
    identity.appId !== "org.sestina.desktop" ||
    identity.storageName !== "Sestina Candidate")
)
  throw Error("desktop_product_identity_invalid");
if (
  identity.channel === "stable" &&
  (identity.profile !== "release" ||
    identity.publicTag !== `v${identity.version}` ||
    !Object.keys(identity.update?.roots ?? {}).length)
)
  throw Error("desktop_release_identity_invalid");
if (
  identity.channel === "internal_candidate" &&
  (identity.update?.source || Object.keys(identity.update?.roots ?? {}).length)
)
  throw Error("candidate_production_trust_refused");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, windowsHide: true });
const expectedSource =
  process.argv[4] ?? git("rev-parse", "HEAD").toString().trim();
if (identity.sourceCommit !== expectedSource)
  throw new Error("desktop_expected_source_mismatch");
if (
  identity.sourceTree !==
  git("rev-parse", `${expectedSource}^{tree}`).toString().trim()
)
  throw new Error("desktop_source_tree_mismatch");
for (const [field, path] of [
  ["lockSha256", "pnpm-lock.yaml"],
  ["migrationSourceSha256", "packages/storage/src/kernel-schema.ts"],
  ["logoSha256", "apps/research-room/client/public/sestina-logo.png"],
]) {
  if (identity[field] !== sha(git("show", `${expectedSource}:${path}`)))
    throw new Error(`desktop_source_content_mismatch:${field}`);
}
if (
  JSON.parse(asar.extractFile(archive, "package.json").toString()).version !==
  identity.version
)
  throw new Error("desktop_package_version_mismatch");
const binaryPath = join(
  directory,
  desktopExecutable(identity, identity.platform),
);
assertDesktopBinary(
  await readFile(binaryPath),
  identity.platform,
  identity.arch,
);
const expected = new Set(manifest.files.map((file) => "/" + file.path));
if (expected.size !== manifest.files.length)
  throw Error("desktop_duplicate_content");
const companion =
  /^dist\/companion\/(?:index\.js|main\.js|runtime\.js|package\.json|runtime-identity\.json|NODE-LICENSE\.txt|node(?:\.exe)?|sestina-mcp(?:\.cmd)?|skills\/(?:agent-corrector|sestina-research-integrity)\/(?:SKILL\.md|agents\/openai\.yaml|references\/(?:drift-rubrics|intervention-contract|task-anchor)\.md))$/;
const native =
  /^dist\/node_modules\/(?:@primno\/dpapi\/(?:package\.json|LICENSE|dist\/index\.js|prebuilds\/win32-(?:x64|arm64)\/@primno\+dpapi\.node)|node-gyp-build\/(?:package\.json|LICENSE|index\.js|node-gyp-build\.js)|@napi-rs\/keyring(?:-(?:darwin-arm64|linux-x64-gnu))?\/(?:package\.json|LICENSE|README\.md|index\.js|keytar\.js|keyring\.[a-z0-9-]+\.node))$/;
for (const file of manifest.files) {
  if (
    !/^(?:dist\/(?:main\.cjs|preload\.cjs|assets\.json|identity\.json|(?:renderer|runtime)-inputs\.json|client\/(?:index\.html|sestina-logo\.png|assets\/[a-zA-Z0-9_.-]+))|package\.json|LICENSE|THIRD-PARTY-NOTICES\.md)$/.test(
      file.path,
    ) &&
    !companion.test(file.path) &&
    !native.test(file.path)
  )
    throw new Error("desktop_unapproved_content");
  const bytes = companion.test(file.path)
    ? await readFile(join(resources, file.path.slice(5)))
    : native.test(file.path)
      ? await readFile(join(resources, "native", file.path.slice(5)))
      : asar.extractFile(archive, normalize(file.path));
  if (bytes.length !== file.size || sha(bytes) !== file.sha256)
    throw new Error(`desktop_content_mismatch:${file.path}`);
}
async function inspectResources(folder, prefix) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name),
      name = `${prefix}/${entry.name}`;
    if (entry.isSymbolicLink()) throw Error("desktop_resource_symlink");
    if (entry.isDirectory()) await inspectResources(path, name);
    else if (!entry.isFile() || !expected.has(name))
      throw Error(`desktop_unlisted_content:${name}`);
  }
}
await inspectResources(join(resources, "companion"), "/dist/companion");
await inspectResources(
  join(resources, "native/node_modules"),
  "/dist/node_modules",
);
const runtime = JSON.parse(
  await readFile(join(resources, "companion/runtime-identity.json"), "utf8"),
);
const runtimeBytes = await readFile(
  join(
    resources,
    "companion",
    identity.platform === "win32" ? "node.exe" : "node",
  ),
);
if (
  runtime.platform !== identity.platform ||
  runtime.arch !== identity.arch ||
  runtime.version !== "24.13.0" ||
  runtime.sha256 !== sha(runtimeBytes)
)
  throw Error("desktop_companion_identity_mismatch");
assertDesktopBinary(runtimeBytes, identity.platform, identity.arch);
if (!(await lstat(join(resources, "companion"))).isDirectory())
  throw Error("desktop_companion_missing");
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
let outerSignature = { status: "not_observed" };
if (process.argv[5]) {
  const installer = resolve(process.argv[5]);
  const installerSha256 = sha(await readFile(installer));
  if (
    manifest.envelope &&
    !manifest.envelope.files?.some((file) => file.sha256 === installerSha256)
  )
    throw Error("desktop_envelope_bytes_mismatch");
  if (process.platform === "win32") {
    const inspect = (file) =>
      JSON.parse(
        execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$s=Get-AuthenticodeSignature -LiteralPath $env:SESTINA_SIGNATURE_TARGET; @{status=[string]$s.Status; signer=$s.SignerCertificate.Thumbprint} | ConvertTo-Json -Compress",
          ],
          {
            windowsHide: true,
            encoding: "utf8",
            env: { ...process.env, SESTINA_SIGNATURE_TARGET: file },
          },
        ),
      );
    const actual = inspect(installer),
      binary = inspect(binaryPath);
    if (
      identity.channel === "stable" &&
      (actual.status !== "Valid" ||
        binary.status !== "Valid" ||
        actual.signer !== manifest.envelope?.signer ||
        binary.signer !== actual.signer)
    )
      throw Error("desktop_release_signature_invalid");
    outerSignature = {
      ...actual,
      binaryStatus: binary.status,
      installerSha256,
    };
  } else if (identity.channel === "stable" && process.platform === "darwin") {
    for (const [tool, args] of [
      ["codesign", ["--verify", "--deep", "--strict", directory]],
      ["spctl", ["--assess", "--type", "execute", directory]],
      ["xcrun", ["stapler", "validate", directory]],
      ["hdiutil", ["verify", installer]],
    ])
      execFileSync(tool, args, { stdio: "pipe" });
    outerSignature = { status: "signed_notarized_verified", installerSha256 };
  } else
    outerSignature = {
      status: manifest.signingStatus ?? "not_configured",
      installerSha256,
    };
} else if (identity.channel === "stable")
  throw Error("desktop_release_installer_required");
console.log(
  JSON.stringify({
    passed: true,
    installedDirectory: directory,
    identity,
    verifiedFiles: expected.size,
    outerSignature,
  }),
);
