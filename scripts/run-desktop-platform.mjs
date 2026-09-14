import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { desktopExecutable } from "./lib/desktop-distribution.mjs";
import { fileSha256 } from "./lib/desktop-readiness.mjs";

const { values } = parseArgs({
  options: {
    profile: { type: "string", default: "candidate" },
    version: { type: "string", default: "0.3.0" },
    tag: { type: "string" },
    "release-config": { type: "string" },
    "shared-public": { type: "string" },
    "previous-installer": { type: "string" },
    "lifecycle-result": { type: "string" },
    output: { type: "string", default: ".tmp/desktop-platform" },
  },
});
const area = resolve(values.output);
if (
  !area.startsWith(resolve(".tmp") + "/") &&
  !area.startsWith(resolve(".tmp") + "\\")
)
  throw Error("isolated_platform_area_required");
await mkdir(area, { recursive: true });
const node = (script, args = [], env = process.env) =>
  execFileSync(process.execPath, [resolve(script), ...args], {
    env,
    windowsHide: true,
    stdio: "inherit",
  });
const artifacts = join(area, "artifacts");
const buildArgs = [
  process.platform,
  "--profile",
  values.profile,
  "--version",
  values.version,
  "--output",
  artifacts,
];
if (values.tag) buildArgs.push("--tag", values.tag);
if (values["release-config"])
  buildArgs.push("--release-config", values["release-config"]);
node("scripts/package-desktop.mjs", buildArgs);
const manifestPath = join(artifacts, "candidate-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const installer = join(artifacts, manifest.envelope.files[0].name);
const installed = join(
  area,
  process.platform === "darwin" ? "installed/Sestina.app" : "installed",
);
let lifecycle = values["lifecycle-result"];
const run = (command, args) =>
  execFileSync(command, args, { windowsHide: true, stdio: "inherit" });
if (process.platform === "win32" && values["previous-installer"]) {
  node(
    "node_modules/vite-node/vite-node.mjs",
    [
      "--config",
      "tests/post-0.2/vitest.foundation.config.ts",
      "tests/desktop/installed-lifecycle.ts",
    ],
    {
      ...process.env,
      SESTINA_UPGRADE_AREA: area,
      SESTINA_PREVIOUS_INSTALLER: resolve(values["previous-installer"]),
      SESTINA_UPGRADE_INSTALLER: installer,
      SESTINA_UPGRADE_MANIFEST: manifestPath,
    },
  );
  lifecycle = join(area, "lifecycle-result.json");
} else if (process.platform === "win32") {
  await new Promise((done, reject) => {
    const child = spawn(installer, ["/S", `/D=${installed}`], {
      windowsHide: true,
      windowsVerbatimArguments: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? done() : reject(Error(`install_exit_${code}`)),
    );
  });
} else if (process.platform === "darwin") {
  const mount = join(area, "dmg-mount");
  await mkdir(mount);
  run("hdiutil", [
    "attach",
    "-nobrowse",
    "-readonly",
    "-mountpoint",
    mount,
    installer,
  ]);
  try {
    await mkdir(join(area, "installed"));
    run("ditto", [join(mount, "Sestina.app"), installed]);
  } finally {
    run("hdiutil", ["detach", mount]);
  }
} else {
  const extract = join(area, "appimage-extract");
  await mkdir(extract);
  execFileSync(installer, ["--appimage-extract"], {
    cwd: extract,
    stdio: "ignore",
  });
  await cp(join(extract, "squashfs-root"), installed, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
}
await writeFile(
  join(area, "installation.json"),
  JSON.stringify(
    {
      sourceCommit: manifest.sourceCommit,
      installerSha256: fileSha256(installer),
      platform: process.platform,
      arch: process.arch,
      installed,
      executable: desktopExecutable(manifest, process.platform),
      kind:
        process.platform === "linux"
          ? "actual_appimage_extraction"
          : "actual_installer",
      nativeWizard: "not_established",
      upgradeLifecycle: lifecycle ? "supplied_bound_result" : "not_established",
    },
    null,
    2,
  ),
);
const args = [
  "--phase",
  "final",
  "--manifest",
  manifestPath,
  "--installed",
  installed,
  "--installer",
  installer,
  "--output",
  join(area, "verification"),
];
if (lifecycle) args.push("--lifecycle-result", lifecycle);
if (values["shared-public"])
  args.push("--shared-public", values["shared-public"]);
node("scripts/run-target-gates.mjs", args, {
  ...process.env,
  SESTINA_RELEASE_CONFIG: values["release-config"] ?? "",
});
