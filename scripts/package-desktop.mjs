import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createDeterministicTarGzip } from "./lib/archive.mjs";

const root = resolve(import.meta.dirname, "..");
const { build, Platform, Arch } = createRequire(
  join(root, "apps/desktop/package.json"),
)("electron-builder");
const target = process.argv[2] ?? process.platform;
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
);
if (dirty) throw new Error("desktop_source_not_committed");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const version = `0.2.0-g10.${sourceCommit.slice(0, 8)}`;
const output = join(root, "release", "desktop", `${target}-${architecture}`);
const staging = join(
  root,
  ".tmp",
  "desktop-packaging",
  `${target}-${architecture}`,
  sourceCommit,
);
const app = join(staging, "app");
await mkdir(app, { recursive: true });
await mkdir(output, { recursive: true });
execFileSync(process.execPath, [join(root, "scripts/build-desktop.mjs")], {
  cwd: root,
  windowsHide: true,
  stdio: "inherit",
});
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
  channel: "internal_candidate",
  version,
  sourceCommit,
  sourceTree,
  lockSha256: sha(lockBytes),
  electron: "44.3.0",
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
        mode: 0o644,
      });
  }
}
await walk();
await createDeterministicTarGzip(join(output, "unsigned-core.tar.gz"), entries);
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
    files: ["dist/**/*", "package.json", "LICENSE"],
    asar: true,
    npmRebuild: false,
    publish: null,
    win: { target: "nsis", signAndEditExecutable: false },
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
    linux: { target: "AppImage", category: "Office" },
  },
});
console.log(JSON.stringify({ output, identity }));
