import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
  cp,
  rename,
} from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { parseArgs } from "node:util";
import { createDeterministicTarGzip } from "./lib/archive.mjs";

const root = resolve(import.meta.dirname, "..");
// This local recipe never consumes a signing account inherited from the shell.
for (const key of Object.keys(process.env))
  if (/^(?:WIN_)?CSC_/.test(key)) delete process.env[key];
process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
const { build, Platform, Arch } = createRequire(
  join(root, "apps/desktop/package.json"),
)("electron-builder");
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    output: { type: "string" },
    "core-only": { type: "boolean", default: false },
  },
});
if (positionals.length > 1) throw Error("unexpected_packaging_argument");
const target = positionals[0] ?? process.platform;
const architecture = target === "darwin" ? "arm64" : "x64";
if (!["win32", "darwin", "linux"].includes(target))
  throw new Error("unsupported_desktop_target");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, windowsHide: true }).toString().trim();
const sourceCommit = git("rev-parse", "HEAD"),
  sourceTree = git("rev-parse", "HEAD^{tree}");
// Reference material and inherited local preferences are outside the build.
const dirty = git(
  "diff",
  "HEAD",
  "--name-only",
  "--",
  "apps",
  "packages",
  "scripts",
  "pnpm-workspace.yaml",
  "package.json",
  "docs/release/THIRD-PARTY-NOTICES.md",
);
if (dirty) throw new Error("desktop_source_not_committed");
if (
  git(
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    "apps",
    "packages",
    "scripts",
  )
)
  throw new Error("desktop_untracked_source");
const committedLock = execFileSync(
  "git",
  ["show", `${sourceCommit}:pnpm-lock.yaml`],
  { cwd: root, windowsHide: true },
);
// This retired importer is an inherited local cleanup, outside every desktop dependency.
const runtimeLock = (bytes) =>
  bytes
    .toString()
    .replaceAll("\r\n", "\n")
    .replace(/^  spikes\/mcp-v2:\n[\s\S]*?(?=^packages:)/m, "");
if (
  runtimeLock(committedLock) !==
  runtimeLock(await readFile(join(root, "pnpm-lock.yaml")))
)
  throw new Error("desktop_dependency_lock_changed");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const version = `0.2.0-g10.${sourceCommit.slice(0, 8)}`;
const output = values.output
  ? resolve(values.output)
  : join(root, "release", "desktop", `${target}-${architecture}`);
if (!/^(?:\.tmp|release)[\\/]/.test(relative(root, output)))
  throw Error("desktop_output_outside_artifact_area");
const staging = join(
  root,
  ".tmp",
  "desktop-packaging",
  `${target}-${architecture}`,
  sourceCommit,
  randomUUID(),
);
const app = join(staging, "app");
await mkdir(app, { recursive: true });
await mkdir(output, { recursive: true });
execFileSync(
  process.execPath,
  [join(root, "scripts/build-desktop.mjs"), target, architecture],
  {
    cwd: root,
    windowsHide: true,
    stdio: "inherit",
  },
);
await cp(join(root, "apps/desktop/dist"), join(app, "dist"), {
  recursive: true,
  force: true,
});
const lockBytes = execFileSync(
  "git",
  ["show", `${sourceCommit}:pnpm-lock.yaml`],
  { cwd: root, windowsHide: true },
);
const identity = {
  sequence: Number(git("show", "-s", "--format=%ct", sourceCommit)),
  channel: "internal_candidate",
  version,
  sourceCommit,
  sourceTree,
  lockSha256: sha(lockBytes),
  electron: "44.3.0",
  buildNode: process.versions.node,
  packageManager: JSON.parse(await readFile(join(root, "package.json"), "utf8"))
    .packageManager,
  buildCommand: `pnpm desktop:package ${target}`,
  migrationSourceSha256: sha(
    execFileSync(
      "git",
      ["show", `${sourceCommit}:packages/storage/src/kernel-schema.ts`],
      { cwd: root, windowsHide: true },
    ),
  ),
  schema: 25,
  platform: target,
  arch: architecture,
  logoSha256: sha(
    await readFile(
      join(root, "apps/research-room/client/public/sestina-logo.png"),
    ),
  ),
  signed: false,
};
await writeFile(
  join(app, "dist/identity.json"),
  JSON.stringify(identity, null, 2) + "\n",
);
await writeFile(
  join(app, "package.json"),
  JSON.stringify(
    {
      name: "sestina-desktop-candidate",
      version,
      description: "Internal Sestina desktop candidate",
      author: "Sestina contributors",
      license: "Apache-2.0",
      main: "dist/main.cjs",
    },
    null,
    2,
  ) + "\n",
);
await cp(join(root, "LICENSE"), join(app, "LICENSE"));
await cp(
  join(root, "docs/release/THIRD-PARTY-NOTICES.md"),
  join(app, "THIRD-PARTY-NOTICES.md"),
);
const entries = [];
async function walk(relative = "") {
  for (const entry of (
    await readdir(join(app, relative), { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = relative + entry.name;
    if (entry.isSymbolicLink()) throw new Error("desktop_package_symlink");
    if (entry.isDirectory()) await walk(name + "/");
    else
      entries.push({
        path: name,
        data: await readFile(join(app, name)),
        mode:
          target !== "win32" &&
          ["dist/companion/node", "dist/companion/sestina-mcp"].includes(name)
            ? 0o755
            : 0o644,
      });
  }
}
await walk();
// The bundled Node executable is about 90 MB. Preview archive limits retain
// their defaults; only this exact runtime entry receives the desktop allowance.
for (const entry of entries)
  if (
    entry.data.length > 32 * 1024 * 1024 &&
    !/^dist\/companion\/node(?:\.exe)?$/.test(entry.path)
  )
    throw Error("desktop_entry_too_large");
await createDeterministicTarGzip(
  join(output, "unsigned-core.tar.gz"),
  entries,
  {
    maxFiles: 256,
    maxEntryBytes: 128 * 1024 * 1024,
    maxTotalBytes: 256 * 1024 * 1024,
  },
);
const core = await readFile(join(output, "unsigned-core.tar.gz"));

await writeFile(
  join(output, "candidate-manifest.json"),
  JSON.stringify(
    {
      ...identity,
      unsignedCoreSha256: sha(core),
      files: entries.map((entry) => ({
        path: entry.path,
        size: entry.data.length,
        sha256: sha(entry.data),
      })),
      signingStatus: "not_configured",
    },
    null,
    2,
  ) + "\n",
);
if (values["core-only"]) {
  console.log(
    JSON.stringify({
      output,
      identity,
      coreOnly: true,
      unsignedCoreSha256: sha(core),
    }),
  );
  process.exit(0);
}
const targets =
  target === "win32"
    ? Platform.WINDOWS.createTarget(["nsis"], Arch.x64)
    : target === "darwin"
      ? Platform.MAC.createTarget(["dmg"], Arch.arm64)
      : Platform.LINUX.createTarget(["AppImage"], Arch.x64);
await build({
  targets,
  config: {
    appId: "org.sestina.candidate",
    productName: "Sestina Candidate",
    electronVersion: "44.3.0",
    directories: { app, output },
    files: [
      "dist/**/*",
      "!dist/companion/**/*",
      "!dist/node_modules/**/*",
      "package.json",
      "LICENSE",
      "THIRD-PARTY-NOTICES.md",
    ],
    extraResources: [
      { from: join(app, "dist/companion"), to: "companion" },
      { from: join(app, "dist/node_modules"), to: "native/node_modules" },
    ],
    asar: true,
    npmRebuild: false,
    publish: null,
    win: {
      target: "nsis",
      signExecutable: false,
      icon: join(root, "apps/research-room/client/public/sestina-logo.png"),
    },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      deleteAppDataOnUninstall: false,
    },
    mac: {
      target: "dmg",
      identity: null,
      category: "public.app-category.productivity",
    },
    linux: {
      target: "AppImage",
      category: "Office",
      executableName: "sestina-candidate",
    },
  },
});
// Builder's unresolved NSIS diagnostic template is build metadata, not a release manifest.
await rename(
  join(output, "builder-debug.yml"),
  join(staging, "builder-debug.yml"),
).catch((error) => {
  if (error.code !== "ENOENT") throw error;
});
console.log(JSON.stringify({ output, identity }));
