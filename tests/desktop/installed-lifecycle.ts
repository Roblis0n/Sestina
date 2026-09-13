import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { productionUiProject } from "../post-0.2/ui-factory.js";
import { migrateKernelProject } from "@sestina/core";

// This is the existing supported silent installer/update contract. It does not
// automate the blocked native uninstall wizard or substitute for its observation.
const area = resolve(process.env.SESTINA_UPGRADE_AREA ?? "");
const previous = process.env.SESTINA_PREVIOUS_INSTALLER;
const next = process.env.SESTINA_UPGRADE_INSTALLER;
const manifestPath = process.env.SESTINA_UPGRADE_MANIFEST;
if (
  process.platform !== "win32" ||
  !previous ||
  !next ||
  !manifestPath ||
  !relative(resolve(".tmp"), area) ||
  relative(resolve(".tmp"), area).startsWith("..")
)
  throw Error("isolated_windows_lifecycle_inputs_required");
const installed = join(area, "installed");
await mkdir(area, { recursive: true });
await writeFile(
  join(area, "lifecycle-result.json"),
  JSON.stringify({ passed: false, status: "running" }),
);
if (
  await access(installed).then(
    () => true,
    () => false,
  )
)
  throw Error("lifecycle_requires_fresh_isolated_install_directory");
const fixture = await productionUiProject();
await migrateKernelProject({ projectRoot: fixture.root });
const { cp } = await import("node:fs/promises");
await cp(fixture.root, join(area, "install-project"), {
  recursive: true,
  force: false,
  errorOnExist: true,
});
await new Promise<void>((done, reject) => {
  const child = spawn(resolve(previous), ["/S", `/D=${installed}`], {
    windowsHide: true,
    windowsVerbatimArguments: true,
    stdio: "ignore",
  });
  child.once("error", reject);
  child.once("exit", (code) =>
    code === 0 ? done() : reject(Error(`initial_install_exit_${code}`)),
  );
});
execFileSync(
  process.execPath,
  [resolve("scripts/verify-desktop-upgrade.mjs")],
  { env: process.env, windowsHide: true, stdio: "inherit" },
);
const upgrade = JSON.parse(
  await readFile(join(area, "installed-upgrade-result.json"), "utf8"),
);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (
  !upgrade.passed ||
  !upgrade.verifiedPreviousProgramActuallyOpened ||
  upgrade.next.sourceCommit !== manifest.sourceCommit
)
  throw Error("lifecycle_upgrade_incomplete");
await writeFile(
  join(area, "lifecycle-result.json"),
  JSON.stringify(
    {
      passed: true,
      sourceCommit: manifest.sourceCommit,
      platform: process.platform,
      arch: process.arch,
      installerSha256: createHash("sha256")
        .update(await readFile(next))
        .digest("hex"),
      installed,
      cases: [
        "actual-initial-silent-install",
        "pre-upgrade-sqlite-backup",
        "backup-failure-blocks-installer",
        "verified-candidate-silent-upgrade",
        "restart-no-update-request",
        "preserved-old-program-actually-opened",
      ],
      upgrade,
      notEstablished: [
        "native-uninstall-wizard",
        "uninstall-reinstall-current-package",
        "production-update-trust",
        "platform-signature",
      ],
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    passed: true,
    installed,
    result: join(area, "lifecycle-result.json"),
  }),
);
