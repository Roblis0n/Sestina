import { execFileSync, spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
  cp,
  access,
  chmod,
} from "node:fs/promises";
import { resolve, join, dirname, relative } from "node:path";
import { parseArgs } from "node:util";
import { desktopExecutable } from "./lib/desktop-distribution.mjs";
import { fileSha256 } from "./lib/desktop-readiness.mjs";
import {
  desktopEvidenceArguments,
  inspectTargetRelease,
  verifyPublishedTargetRelease,
} from "./lib/target-verification.mjs";

const { values } = parseArgs({
  options: {
    profile: { type: "string", default: "candidate" },
    version: { type: "string", default: "0.3.0" },
    tag: { type: "string" },
    "release-config": { type: "string" },
    "shared-public": { type: "string" },
    "previous-installer": { type: "string" },
    "previous-manifest": { type: "string" },
    manifest: { type: "string" },
    installer: { type: "string" },
    installed: { type: "string" },
    "lifecycle-result": { type: "string" },
    "reinstall-result": { type: "string" },
    "visual-observation": { type: "string" },
    readiness: { type: "string" },
    "run-reinstall": { type: "boolean", default: false },
    "update-private-key": { type: "string" },
    "update-key-id": { type: "string" },
    "published-directory": { type: "string" },
    "published-repository": { type: "string" },
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
let publication;
try {
  if (values["published-directory"] || values["published-repository"]) {
    if (
      !values["published-directory"] ||
      !values["published-repository"] ||
      values.manifest ||
      values.installed ||
      values["previous-installer"] ||
      values["update-private-key"]
    )
      throw Error(
        "published_installation_requires_reviewed_directory_repository_and_fresh_installation",
      );
    const index = await inspectTargetRelease(
      resolve(values["published-directory"]),
      {},
    );
    publication = await verifyPublishedTargetRelease({
      directory: resolve(values["published-directory"]),
      repository: values["published-repository"],
      identity: {
        sourceCommit: index.sourceCommit,
        publicTag: index.publicTag,
        version: index.version,
      },
      output: join(area, "published-download"),
    });
    await writeFile(
      join(area, "download-receipt.json"),
      JSON.stringify(publication, null, 2),
    );
    const asset = (role) =>
      index.assets.find(
        (item) =>
          item.target === `${process.platform}-${process.arch}` &&
          item.role === role,
      );
    values.manifest = join(publication.directory, asset("manifest").name);
    values.installer = join(publication.directory, asset("installer").name);
    values.profile = "release";
    values.version = index.version;
    values.tag = index.publicTag;
  }
  if (
    !!values.manifest !== !!values.installer ||
    (values.installed && !values.manifest)
  )
    throw Error("existing_package_requires_manifest_and_installer");
  if (values["previous-installer"] && !values["previous-manifest"])
    throw Error("previous_installer_manifest_required");
  if (values["previous-installer"] && process.platform !== "win32")
    throw Error(
      "native_platform_lifecycle_result_required_use_bound_results_not_windows_installer_automation",
    );
  if (
    values["previous-installer"] &&
    (values.installed || values["lifecycle-result"])
  )
    throw Error("choose_executed_lifecycle_or_bound_result");
  if (
    values["run-reinstall"] &&
    (process.platform !== "win32" ||
      !values["previous-installer"] ||
      values["reinstall-result"])
  )
    throw Error("reinstall_execution_requires_fresh_windows_lifecycle");
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
  if (!values.manifest) node("scripts/package-desktop.mjs", buildArgs);
  const manifestPath = values.manifest
    ? resolve(values.manifest)
    : join(artifacts, "candidate-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const installer = values.installer
    ? resolve(values.installer)
    : join(artifacts, manifest.envelope.files[0].name);
  if (
    manifest.platform !== process.platform ||
    manifest.arch !== process.arch ||
    !manifest.envelope?.files?.some(
      (file) => file.sha256 === fileSha256(installer),
    )
  )
    throw Error("platform_package_binding_mismatch");
  if (
    manifest.profile !== values.profile ||
    (values.profile === "release" &&
      (manifest.version !== values.version ||
        manifest.publicTag !== values.tag))
  )
    throw Error("platform_distribution_profile_mismatch");
  if (!!values["update-private-key"] !== !!values["update-key-id"])
    throw Error("explicit_update_key_and_id_required");
  if (values["update-private-key"])
    node("scripts/sign-desktop-update.mjs", [
      "--manifest",
      manifestPath,
      "--installer",
      installer,
      "--private-key",
      resolve(values["update-private-key"]),
      "--key-id",
      values["update-key-id"],
      "--output",
      join(area, "update"),
    ]);
  if (values.manifest && !publication) {
    // Keep supplied artifacts available to the workflow uploader as well.
    await mkdir(artifacts, { recursive: true });
    const sums = (
      await readFile(join(dirname(manifestPath), "SHA256SUMS"), "utf8")
    )
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const matched = /^([a-f0-9]{64})  ([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(
          line,
        );
        if (
          !matched ||
          fileSha256(join(dirname(manifestPath), matched[2])) !== matched[1]
        )
          throw Error("supplied_package_checksum_mismatch");
        return matched[2];
      });
    for (const file of ["SHA256SUMS", ...sums]) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file))
        throw Error("package_asset_name_invalid");
      const source = join(dirname(manifestPath), file),
        destination = join(artifacts, file);
      if (source !== destination)
        await cp(source, destination, { force: false, errorOnExist: true });
    }
  }
  if (values["previous-installer"]) {
    const previous = JSON.parse(
      await readFile(resolve(values["previous-manifest"]), "utf8"),
    );
    if (
      previous.platform !== process.platform ||
      previous.arch !== process.arch ||
      !previous.envelope?.files?.some(
        (file) =>
          file.sha256 === fileSha256(resolve(values["previous-installer"])),
      )
    )
      throw Error("previous_package_binding_mismatch");
  }
  const installed = values.installed
    ? resolve(values.installed)
    : join(
        area,
        process.platform === "darwin" ? "installed/Sestina.app" : "installed",
      );
  let lifecycle = values["lifecycle-result"];
  if (!values.installed) {
    const occupied = await access(installed).then(
      () => true,
      () => false,
    );
    if (occupied) throw Error("fresh_isolated_installation_directory_required");
  }
  const run = (command, args) =>
    execFileSync(command, args, { windowsHide: true, stdio: "inherit" });
  if (values.installed) {
    // The common artifact verifier rechecks the selected installation before use.
  } else if (process.platform === "win32" && values["previous-installer"]) {
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
    if (values["run-reinstall"]) {
      node(
        "node_modules/vite-node/vite-node.mjs",
        [
          "--config",
          "tests/post-0.2/vitest.foundation.config.ts",
          "tests/desktop/installed-reinstall.ts",
        ],
        {
          ...process.env,
          SESTINA_UPGRADE_AREA: area,
          SESTINA_UPGRADE_INSTALLER: installer,
          SESTINA_UPGRADE_MANIFEST: manifestPath,
        },
      );
      values["reinstall-result"] = join(area, "reinstall-result.json");
    }
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
    await chmod(installer, 0o755);
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
        verificationCommit: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
          windowsHide: true,
        }).trim(),
        manifestSha256: fileSha256(manifestPath),
        previousInstallerSha256: values["previous-installer"]
          ? fileSha256(resolve(values["previous-installer"]))
          : null,
        executable: desktopExecutable(manifest, process.platform),
        kind: values.installed
          ? "existing_installation_reverified"
          : process.platform === "linux"
            ? "actual_appimage_extraction"
            : "actual_installer",
        nativeWizard: "not_established",
        upgradeLifecycle: lifecycle
          ? "supplied_bound_result"
          : "not_established",
      },
      null,
      2,
    ),
  );
  if (publication) {
    // Recheck the downloaded installation and reuse the established research
    // journey fixture, without rerunning public/performance/visual acceptance.
    const artifactOutput = execFileSync(
      process.execPath,
      [
        resolve("scripts/verify-desktop-artifact.mjs"),
        installed,
        manifestPath,
        manifest.sourceCommit,
        installer,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    await writeFile(join(area, "published-artifact.log"), artifactOutput);
    const checked = JSON.parse(artifactOutput.trim().split(/\r?\n/).at(-1));
    if (
      !checked.passed ||
      checked.identity.sourceCommit !== manifest.sourceCommit
    )
      throw Error("published_installed_artifact_failed");
    const environment = {
      ...process.env,
      SESTINA_TEST_INSTALLED_EXECUTABLE: join(
        installed,
        desktopExecutable(manifest, process.platform),
      ),
      SESTINA_TARGET_OUTPUT: join(area, "published-journeys"),
    };
    delete environment.ELECTRON_RUN_AS_NODE;
    delete environment.SESTINA_TEST_ALLOW_DEVELOPMENT;
    node(
      "node_modules/vite-node/vite-node.mjs",
      [
        "--config",
        "tests/post-0.2/vitest.foundation.config.ts",
        "tests/desktop/installed-journeys.ts",
      ],
      environment,
    );
    const journeyPath = join(area, "published-journeys/result.json");
    const journeys = JSON.parse(await readFile(journeyPath, "utf8"));
    if (
      !journeys.passed ||
      journeys.identity.sourceCommit !== manifest.sourceCommit ||
      !journeys.cases.includes("offline-decision-restart-views")
    )
      throw Error("published_reopen_not_executed");
    await writeFile(
      join(area, "published-installation.json"),
      JSON.stringify(
        {
          passed: true,
          sourceCommit: manifest.sourceCommit,
          installerSha256: fileSha256(installer),
          platform: process.platform,
          arch: process.arch,
          verificationCommit: execFileSync("git", ["rev-parse", "HEAD"], {
            encoding: "utf8",
            windowsHide: true,
          }).trim(),
          installed,
          repository: publication.repository,
          tag: publication.tag,
          origin: "github_release_download",
          skipped: 0,
          todo: 0,
          cases: [
            "downloaded-package-installed",
            "installed-artifact-verified",
            "project-open-quit-reopen",
          ],
          evidence: [
            join(area, "download-receipt.json"),
            join(area, "installation.json"),
            join(area, "published-artifact.log"),
            journeyPath,
          ].map((path, index) => ({
            role: ["download", "installation", "artifact", "journeys"][index],
            path: relative(area, path).replaceAll("\\", "/"),
            sha256: fileSha256(path),
          })),
          nativeObservation: "separate_formal_acceptance_required",
        },
        null,
        2,
      ),
    );
  } else {
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
    args.push(
      ...desktopEvidenceArguments({ ...values, "lifecycle-result": lifecycle }),
    );
    node("scripts/run-target-gates.mjs", args, {
      ...process.env,
      SESTINA_RELEASE_CONFIG: values["release-config"] ?? "",
    });
  }
} catch (error) {
  await writeFile(
    join(area, "platform-failure.json"),
    JSON.stringify(
      {
        platform: process.platform,
        arch: process.arch,
        localPassed: false,
        formalAcceptance: "not_established",
        published: false,
        error: String(error),
      },
      null,
      2,
    ),
  );
  throw error;
}
