import { createHash, randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream, readFileSync, existsSync } from "node:fs";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, join, dirname, relative } from "node:path";
import { parseArgs } from "node:util";
import { desktopExecutable } from "./lib/desktop-distribution.mjs";
import {
  fileSha256,
  inspectDesktopReadiness,
} from "./lib/desktop-readiness.mjs";
import {
  assertExecutedTests,
  canReuseTargetCheck,
  targetCheckAffected,
  assertTargetTagIdentity,
  assertLifecycleResult,
  assertReinstallResult,
  assertReadinessBinding,
  aggregateTargetResults,
  assembleTargetRelease,
  inspectTargetRelease,
  verifyPublishedTargetRelease,
  assertPublishedInstallations,
} from "./lib/target-verification.mjs";

const root = resolve(import.meta.dirname, "..");
const { values } = parseArgs({
  options: {
    phase: { type: "string", default: "candidate" },
    manifest: { type: "string" },
    installed: { type: "string" },
    installer: { type: "string" },
    output: { type: "string" },
    readiness: { type: "string" },
    "lifecycle-result": { type: "string" },
    "reinstall-result": { type: "string" },
    "visual-observation": { type: "string" },
    "shared-public": { type: "string" },
    tag: { type: "string" },
    repository: { type: "string" },
    "platform-result": { type: "string", multiple: true },
    "release-inventory": { type: "string" },
    "release-directory": { type: "string" },
    "published-installation": { type: "string", multiple: true },
  },
});
if (values["platform-result"]?.length) {
  const area = resolve(values.output ?? ".tmp/target/combined");
  await mkdir(area, { recursive: true });
  const combinedPath = join(area, "result.json");
  await writeFile(
    combinedPath,
    JSON.stringify({
      schema: 1,
      localPassed: false,
      formalAcceptance: "not_established",
      published: false,
      status: "validating_inputs",
    }),
  );
  try {
    if (!["final", "publish"].includes(values.phase))
      throw Error("combined_results_require_final_or_publish_phase");
    const records = await Promise.all(
      values["platform-result"].map(async (path) => {
        const actual = resolve(path);
        return {
          path: actual,
          sha256: fileSha256(actual),
          result: JSON.parse(await readFile(actual, "utf8")),
        };
      }),
    );
    const combined = aggregateTargetResults(
      records.map((record) => record.result),
    );
    combined.inputs = records.map(({ path, sha256 }) => ({ path, sha256 }));
    combined.phase = values.phase;
    await writeFile(combinedPath, JSON.stringify(combined, null, 2) + "\n");
    if (values["release-inventory"]) {
      if (!values["release-directory"])
        throw Error("release_output_directory_required");
      const inventoryPath = resolve(values["release-inventory"]);
      const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
      if (inventory.schema !== 1 || !Array.isArray(inventory.packages))
        throw Error("release_inventory_invalid");
      combined.release = await assembleTargetRelease(
        inventory.packages.map((item) => ({
          ...item,
          manifest: resolve(dirname(inventoryPath), item.manifest),
          installer: resolve(dirname(inventoryPath), item.installer),
          update: resolve(dirname(inventoryPath), item.update),
        })),
        resolve(values["release-directory"]),
      );
      if (combined.release.sourceCommit !== combined.sourceCommit)
        throw Error("release_acceptance_source_mismatch");
      await writeFile(combinedPath, JSON.stringify(combined, null, 2) + "\n");
    }
    if (values.phase === "publish") {
      if (
        combined.formalAcceptance !== "passed" ||
        !values.repository ||
        !values.tag ||
        !values["release-directory"]
      )
        throw Error("publication_acceptance_incomplete");
      const identity = {
        sourceCommit: combined.sourceCommit,
        publicTag: values.tag,
        version: values.tag.replace(/^v/, ""),
      };
      const index = await inspectTargetRelease(
        resolve(values["release-directory"]),
        identity,
      );
      assertTargetTagIdentity(
        values.tag,
        index.version,
        execFileSync("git", ["rev-parse", `refs/tags/${values.tag}^{commit}`], {
          encoding: "utf8",
          windowsHide: true,
        }).trim(),
        combined.sourceCommit,
      );
      for (const [target, result] of Object.entries(combined.platforms)) {
        if (
          index.assets.find(
            (item) => item.target === target && item.role === "installer",
          )?.sha256 !== result.installerSha256
        )
          throw Error("publication_accepted_package_mismatch");
      }
      combined.publication = await verifyPublishedTargetRelease({
        directory: resolve(values["release-directory"]),
        repository: values.repository,
        identity,
        output: join(area, `published-download-${randomUUID()}`),
      });
      await writeFile(
        join(combined.publication.directory, "download-receipt.json"),
        JSON.stringify(combined.publication, null, 2),
      );
      await writeFile(combinedPath, JSON.stringify(combined, null, 2) + "\n");
      const installations = await Promise.all(
        (values["published-installation"] ?? []).map(async (path) => ({
          path: resolve(path),
          result: JSON.parse(await readFile(resolve(path), "utf8")),
        })),
      );
      await assertPublishedInstallations(
        installations,
        index,
        values.repository,
      );
      combined.published = true;
      await writeFile(combinedPath, JSON.stringify(combined, null, 2) + "\n");
    }
    console.log(
      JSON.stringify({
        localPassed: combined.localPassed,
        formalAcceptance: combined.formalAcceptance,
        result: combinedPath,
      }),
    );
    process.exit(
      combined.localPassed && (values.phase !== "publish" || combined.published)
        ? 0
        : 1,
    );
  } catch (error) {
    const prior = JSON.parse(await readFile(combinedPath, "utf8"));
    await writeFile(
      combinedPath,
      JSON.stringify(
        { ...prior, published: false, error: String(error) },
        null,
        2,
      ),
    );
    process.exit(1);
  }
}
if (values.phase === "publish")
  throw Error(
    "publication_requires_three_platform_results_and_release_directory",
  );
if (
  !["candidate", "final", "publish"].includes(values.phase) ||
  !values.manifest ||
  !values.installed ||
  !values.installer
)
  throw Error(
    "Usage: verify:target --phase candidate|final|publish --manifest <json> --installed <app-directory> --installer <file> [--output <directory>]",
  );
const output = resolve(values.output ?? `.tmp/target/${values.phase}`);
await mkdir(output, { recursive: true });
const resultPath = join(output, "result.json");
const previous = existsSync(resultPath)
  ? JSON.parse(await readFile(resultPath, "utf8"))
  : {};
await writeFile(
  resultPath,
  JSON.stringify({
    schema: 1,
    phase: values.phase,
    localPassed: false,
    formalAcceptance: "not_established",
    published: false,
    status: "validating_inputs",
  }),
);
const git = (...args) =>
  execFileSync("git", args, {
    cwd: root,
    windowsHide: true,
    encoding: "utf8",
  }).trim();
const verificationCommit = git("rev-parse", "HEAD");
const manifest = JSON.parse(await readFile(resolve(values.manifest), "utf8"));
const sourceCommit = manifest.sourceCommit;
const installerSha256 = fileSha256(resolve(values.installer));
const artifact = `${fileSha256(resolve(values.manifest))}:${installerSha256}`;
const executable = join(
  resolve(values.installed),
  desktopExecutable(manifest, manifest.platform),
);
const environment = {
  platform: process.platform,
  arch: process.arch,
  node: process.version,
};
const result = {
  schema: 1,
  phase: values.phase,
  sourceCommit,
  verificationCommit,
  artifactSource: manifest.sourceCommit,
  installerSha256,
  version: manifest.version,
  schemaVersion: manifest.schema,
  migrationSourceSha256: manifest.migrationSourceSha256,
  installed: resolve(values.installed),
  manifestSha256: fileSha256(resolve(values.manifest)),
  manifest: relative(root, resolve(values.manifest)),
  environment,
  localPassed: false,
  formalAcceptance: "not_established",
  platformAcceptance: "not_established",
  published: false,
  checks: {},
  remaining: [],
};
const save = () =>
  writeFile(resultPath, JSON.stringify(result, null, 2) + "\n");
// Clear prior aggregate success before any work. Reuse is per executed check only.
await save();
const sourcePaths = git(
  "ls-files",
  "--",
  "apps",
  "packages",
  "scripts",
  "tests",
  "integrations",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "vitest.config.ts",
  "eslint.config.mjs",
)
  .split("\n")
  .filter(Boolean);
const sourceScope = createHash("sha256")
  .update(
    JSON.stringify(
      sourcePaths.map((path) => [path, fileSha256(join(root, path))]),
    ),
  )
  .digest("hex");
const env = {
  ...process.env,
  CI: "true",
  NO_COLOR: "1",
  SESTINA_TEST_INSTALLED_EXECUTABLE: executable,
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.SESTINA_TEST_ALLOW_DEVELOPMENT;
async function execute(id, args, verify, installed = true, extraEnv = {}) {
  const log = join(output, `${id}.log`);
  const binding = {
    sourceScope,
    platform: `${process.platform}-${process.arch}`,
    artifact: installed ? artifact : null,
    runtime: process.version,
  };
  const prior = previous.checks?.[id];
  let reviewedPrior = prior;
  if (
    prior &&
    /^[a-f0-9]{40}$/.test(previous.verificationCommit ?? "") &&
    previous.artifactSource === sourceCommit
  ) {
    git(
      "merge-base",
      "--is-ancestor",
      previous.verificationCommit,
      verificationCommit,
    );
    const changedInputs = git(
      "diff",
      previous.verificationCommit,
      verificationCommit,
      "--name-only",
    )
      .split("\n")
      .filter(Boolean);
    if (!targetCheckAffected(id, changedInputs))
      reviewedPrior = { ...prior, binding: { ...prior.binding, sourceScope } };
  }
  // Hash the result payload and log together; a stale/changed output cannot be reused.
  const proofPath = join(output, `${id}.proof.json`);
  const proofHash = () =>
    createHash("sha256")
      .update(fileSha256(log))
      .update(fileSha256(proofPath))
      .digest("hex");
  if (
    existsSync(log) &&
    existsSync(proofPath) &&
    (prior?.proof?.images ?? []).every(
      (file) =>
        existsSync(join(root, file.path)) &&
        fileSha256(join(root, file.path)) === file.sha256,
    ) &&
    canReuseTargetCheck(reviewedPrior, binding, proofHash())
  ) {
    const proof = JSON.parse(await readFile(proofPath, "utf8"));
    result.checks[id] = {
      ...reviewedPrior,
      reused: true,
      reusedFromVerificationCommit: previous.verificationCommit,
      proof,
    };
    await save();
    return;
  }
  result.checks[id] = { status: "running", binding, count: 0 };
  await save();
  process.stdout.write(`[target ${values.phase}] ${id}\n`);
  const stream = createWriteStream(log, { flags: "w" });
  const exitCode = await new Promise((done) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: { ...env, ...extraEnv },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(stream, { end: false });
    child.stderr.pipe(stream, { end: false });
    child.once("error", (error) => {
      stream.write(String(error));
      done(1);
    });
    child.once("close", (code) => done(code ?? 1));
  });
  await new Promise((done) => stream.end(done));
  try {
    if (exitCode !== 0) throw Error(`exit_${exitCode}`);
    const proof = await verify(await readFile(log, "utf8"));
    if (!proof || !Number.isInteger(proof.count) || proof.count < 1)
      throw Error("zero_or_missing_checks");
    await writeFile(proofPath, JSON.stringify(proof, null, 2));
    result.checks[id] = {
      status: "passed",
      count: proof.count,
      binding,
      evidenceSha256: proofHash(),
      log: relative(root, log),
      proof,
    };
  } catch (error) {
    result.checks[id] = {
      status: "failed",
      count: 0,
      binding,
      log: relative(root, log),
      error: String(error),
    };
  }
  await save();
}
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const lastJson = (text) =>
  JSON.parse(
    text
      .trim()
      .split(/\r?\n/)
      .filter((line) => line.startsWith("{"))
      .at(-1),
  );
try {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit))
    throw Error("target_artifact_source_invalid");
  git("merge-base", "--is-ancestor", sourceCommit, verificationCommit);
  const changed = git("diff", sourceCommit, "HEAD", "--name-only")
    .split("\n")
    .filter(Boolean);
  if (
    changed.some(
      (path) =>
        (/^(?:apps|packages|integrations)\//.test(path) &&
          !/^(?:apps|packages)\/[^/]+\/test\//.test(path)) ||
        /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json|docs\/release\/THIRD-PARTY-NOTICES\.md|scripts\/(?:build-desktop\.mjs|package-desktop\.mjs|lib\/desktop-(?:distribution|signing)\.mjs))/.test(
          path,
        ),
    )
  )
    throw Error("target_runtime_source_changed_since_artifact");
  if (manifest.platform !== process.platform || manifest.arch !== process.arch)
    throw Error("target_platform_mismatch");
  if (
    git(
      "diff",
      "HEAD",
      "--name-only",
      "--",
      "apps",
      "packages",
      "scripts",
      "tests",
      "integrations",
      "package.json",
      "pnpm-workspace.yaml",
      "tsconfig.base.json",
      "vitest.config.ts",
      "eslint.config.mjs",
    )
  )
    throw Error("target_source_not_committed");
  if (
    git(
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      "apps",
      "packages",
      "scripts",
      "tests",
      "integrations",
    )
  )
    throw Error("target_untracked_source");
  let foundationReuse = "";
  const foundationPath = join(output, "foundation.json");
  const foundationEvidenceSource =
    previous.checks?.public?.proof?.foundationEvidenceSource ??
    previous.verificationCommit;
  if (
    existsSync(foundationPath) &&
    /^[a-f0-9]{40}$/.test(foundationEvidenceSource ?? "")
  ) {
    git(
      "merge-base",
      "--is-ancestor",
      foundationEvidenceSource,
      verificationCommit,
    );
    const changed = git(
      "diff",
      foundationEvidenceSource,
      verificationCommit,
      "--name-only",
    )
      .split("\n")
      .filter(Boolean);
    if (!targetCheckAffected("foundation", changed)) {
      try {
        const count = assertExecutedTests(await readJson(foundationPath));
        foundationReuse = join(output, "foundation-reuse.json");
        await writeFile(
          foundationReuse,
          JSON.stringify(
            {
              sourceCommit: foundationEvidenceSource,
              reportSha256: fileSha256(foundationPath),
              count,
            },
            null,
            2,
          ),
        );
      } catch {
        foundationReuse = "";
      }
    }
  }
  if (values["shared-public"]) {
    const path = resolve(values["shared-public"]);
    const shared = await readJson(path);
    if (
      !shared.passed ||
      shared.sourceCommit !== verificationCommit ||
      shared.node !== process.version ||
      shared.reports?.length !== 2
    )
      throw Error("shared_public_source_mismatch");
    let count = 0;
    if (
      shared.reports
        .map((item) => item.path)
        .sort()
        .join(",") !== "foundation.json,public-unit.json"
    )
      throw Error("shared_public_reports_missing");
    for (const report of shared.reports) {
      const reportPath = join(dirname(path), report.path);
      if (fileSha256(reportPath) !== report.sha256)
        throw Error("shared_public_report_changed");
      const actual = assertExecutedTests(await readJson(reportPath));
      if (actual !== report.count) throw Error("shared_public_count_mismatch");
      count += actual;
    }
    result.checks.public = {
      status: "passed",
      count,
      reused: true,
      proof: shared,
      evidenceSha256: fileSha256(path),
    };
    // The common public gate ran once. Native SQLite/process coverage still runs
    // on each additional OS, using the existing foundation suite.
    if (shared.platform !== process.platform || shared.arch !== process.arch) {
      await execute(
        "native-foundation",
        [
          join(root, "node_modules/vitest/vitest.mjs"),
          "run",
          "--config",
          "tests/post-0.2/vitest.foundation.config.ts",
          "--reporter=json",
          `--outputFile=${join(output, "native-foundation.json")}`,
        ],
        async () => ({
          count: assertExecutedTests(
            await readJson(join(output, "native-foundation.json")),
          ),
        }),
      );
    }
  } else
    await execute(
      "public",
      [join(root, "scripts/run-public-shared-gates.mjs")],
      async (log) => {
        if (!log.includes("all deterministic public gates passed"))
          throw Error("public_gate_incomplete");
        const unit = assertExecutedTests(
          await readJson(join(output, "public-unit.json")),
        );
        const foundation = assertExecutedTests(
          await readJson(join(output, "foundation.json")),
        );
        return {
          count: unit + foundation,
          unit,
          foundation,
          foundationEvidenceSource: foundationReuse
            ? (await readJson(foundationReuse)).sourceCommit
            : verificationCommit,
          scope: "shared-public-and-kernel-foundation-not-preview-installation",
        };
      },
      false,
      {
        SESTINA_VERIFICATION_OUTPUT: output,
        SESTINA_FOUNDATION_REUSE: foundationReuse,
      },
    );
  await execute(
    "artifact",
    [
      join(root, "scripts/verify-desktop-artifact.mjs"),
      resolve(values.installed),
      resolve(values.manifest),
      sourceCommit,
      resolve(values.installer),
    ],
    (log) => {
      const checked = lastJson(log);
      if (
        checked.passed !== true ||
        checked.identity.sourceCommit !== sourceCommit
      )
        throw Error("installed_identity_invalid");
      return {
        count: checked.verifiedFiles,
        identity: checked.identity,
        outerSignature: checked.outerSignature,
      };
    },
  );
  await execute(
    "desktop",
    [
      join(root, "node_modules/vitest/vitest.mjs"),
      "run",
      "--project",
      "desktop",
      "--reporter=default",
      "--reporter=json",
      `--outputFile=${join(output, "desktop.json")}`,
    ],
    async () => ({
      count: assertExecutedTests(await readJson(join(output, "desktop.json"))),
      nativeDialogs: "fixtures_not_native_acceptance",
    }),
  );
  await execute(
    "reproducibility",
    [
      join(root, "scripts/verify-desktop-core-reproducibility.mjs"),
      resolve(values.manifest),
    ],
    (log) => {
      const checked = lastJson(log);
      if (!checked.passed || checked.sourceCommit !== sourceCommit)
        throw Error("core_reproducibility_failed");
      return { count: checked.checks.length, result: checked };
    },
  );
  for (const id of ["journeys", "performance", "resources"]) {
    const area = join(output, id);
    await execute(
      id,
      [
        join(root, "node_modules/vite-node/vite-node.mjs"),
        "--config",
        "tests/post-0.2/vitest.foundation.config.ts",
        `tests/desktop/installed-${id}.ts`,
      ],
      async () => {
        const checked = await readJson(join(area, "result.json"));
        if (
          checked.passed !== true ||
          checked.identity.sourceCommit !== sourceCommit ||
          checked.packaged === false
        )
          throw Error("installed_result_invalid");
        return {
          count: (checked.cases ?? checked.checks).length,
          result: checked,
        };
      },
      true,
      { SESTINA_TARGET_OUTPUT: area },
    );
  }
  const visualArea = join(output, "visual");
  await execute(
    "visual",
    [
      join(root, "node_modules/vite-node/vite-node.mjs"),
      "--config",
      "tests/post-0.2/vitest.foundation.config.ts",
      "tests/desktop/installed-visual.ts",
    ],
    async () => {
      const checked = await readJson(join(visualArea, "results.json"));
      if (
        !checked.passed ||
        checked.records?.length !== 6 ||
        new Set(checked.records.map((item) => `${item.language}:${item.theme}`))
          .size !== 6 ||
        checked.records.some(
          (item) =>
            !item.identity.packaged ||
            item.identity.version !== manifest.version ||
            !item.text200Percent ||
            !item.noRendererNetwork,
        )
      )
        throw Error("installed_visual_matrix_incomplete");
      const images = (await readdir(visualArea))
        .filter((file) => file.endsWith(".png"))
        .map((file) => ({
          path: relative(root, join(visualArea, file)),
          sha256: fileSha256(join(visualArea, file)),
        }));
      if (images.length < 36) throw Error("installed_visual_frames_missing");
      return {
        count: checked.records.length,
        records: checked.records,
        images,
        actualImageInspection: "separate_required_observation",
        nativeDialogs: "fixtures_not_native_acceptance",
      };
    },
    true,
    { SESTINA_DESKTOP_VISUAL_OUTPUT: visualArea },
  );
  if (values["lifecycle-result"]) {
    const path = resolve(values["lifecycle-result"]),
      lifecycle = await readJson(path);
    assertLifecycleResult(lifecycle, {
      sourceCommit,
      installerSha256,
      platform: process.platform,
      arch: process.arch,
    });
    result.checks.lifecycle = {
      status: "passed",
      count: lifecycle.cases.length,
      result: lifecycle,
      evidenceSha256: fileSha256(path),
    };
  } else
    result.checks.lifecycle = {
      status: "not_run",
      count: 0,
      reason: "actual_install_upgrade_recovery_result_required",
    };
  if (values.phase !== "candidate")
    await execute(
      "cutover",
      [
        join(root, "scripts/verify-target-cutover.mjs"),
        resolve(values.installed),
        resolve(values.manifest),
      ],
      (log) => {
        const checked = lastJson(log);
        if (!checked.passed) throw Error("cutover_failed");
        return { count: checked.checks.length, result: checked };
      },
      true,
      { SESTINA_TARGET_OUTPUT: join(output, "cutover") },
    );
  if (values["reinstall-result"]) {
    const path = resolve(values["reinstall-result"]),
      reinstall = await readJson(path);
    const count = assertReinstallResult(reinstall, {
      sourceCommit,
      installerSha256,
      platform: process.platform,
      arch: process.arch,
    });
    result.checks.reinstall = {
      status: "passed",
      count,
      result: reinstall,
      evidenceSha256: fileSha256(path),
    };
  } else
    result.checks.reinstall = {
      status: "not_run",
      count: 0,
      reason: "actual_platform_uninstall_reinstall_result_required",
    };
  result.localPassed = Object.values(result.checks).every(
    (check) => check.status === "passed" && check.count > 0,
  );
  const inventory = values.readiness
    ? await readJson(resolve(values.readiness))
    : {
        schema: 1,
        sourceCommit,
        artifacts: {
          [`${process.platform}-${process.arch}`]: {
            path: resolve(values.installer),
            sha256: installerSha256,
          },
        },
        observations: [],
      };
  assertReadinessBinding(inventory, {
    sourceCommit,
    installerSha256,
    platform: process.platform,
    arch: process.arch,
  });
  const readiness = inspectDesktopReadiness(
    inventory,
    values.readiness ? dirname(resolve(values.readiness)) : root,
  );
  result.readiness = readiness;
  result.remaining = readiness.checks.filter(
    (check) => check.status !== "passed",
  );
  for (const reason of readiness.errors)
    result.remaining.push({
      id: "readiness-inventory",
      status: "failed",
      reason,
    });
  for (const id of result.checks.lifecycle?.result?.notEstablished ?? [])
    if (
      !(
        id === "uninstall-reinstall-current-package" &&
        result.checks.reinstall?.status === "passed"
      ) &&
      !readiness.checks.some(
        (check) =>
          check.status === "passed" &&
          check.id ===
            `${process.platform}-${process.arch}.${{ "native-uninstall-wizard": "native-uninstall", "production-update-trust": "production-trust", "platform-signature": "production-trust" }[id]}`,
      )
    )
      result.remaining.push({ id, status: "not_established" });
  result.remaining.push({
    id: "production-visual-accessibility",
    status: "not_established",
    reason:
      "Actual inspected frames, continuous motion, native focus and assistive-technology evidence are recorded in the merged human evidence index.",
  });
  if (values["visual-observation"]) {
    const observationPath = resolve(values["visual-observation"]);
    const observed = await readJson(observationPath);
    if (
      observed.sourceCommit !== sourceCommit ||
      observed.installerSha256 !== installerSha256 ||
      observed.platform !== process.platform ||
      observed.arch !== process.arch
    )
      throw Error("observation_artifact_mismatch");
    const accepted = new Set();
    for (const check of observed.checks ?? []) {
      if (
        check.status !== "passed" ||
        !Number.isSafeInteger(check.count) ||
        check.count < 1 ||
        !check.files?.length
      )
        throw Error("observation_missing_execution");
      for (const file of check.files)
        if (
          fileSha256(resolve(dirname(observationPath), file.path)) !==
          file.sha256
        )
          throw Error("observation_evidence_changed");
      // A visual receipt cannot waive signing, lifecycle or another OS's work.
      if (
        ![
          "production-visual-accessibility",
          "renderer-image-inspection",
          "renderer-keyboard-scroll",
          "inspected-final-static-frames",
          "scoped-renderer-keyboard-and-scroll",
        ].includes(check.id)
      )
        throw Error("visual_observation_scope_invalid");
      if (
        check.id === "production-visual-accessibility" &&
        (!check.cases?.includes("assistive-technology-research-flow") ||
          !check.cases?.includes("continuous-transition-observed") ||
          !check.cases?.includes("reduced-motion-observed"))
      )
        throw Error("visual_accessibility_cases_incomplete");
      accepted.add(check.id);
    }
    result.remaining = result.remaining.filter(
      (check) => !accepted.has(check.id),
    );
    result.observation = {
      path: relative(root, observationPath),
      sha256: fileSha256(observationPath),
    };
  }
  const target = `${process.platform}-${process.arch}`;
  const localRemaining = result.remaining.filter(
    (check) =>
      !["win32-x64", "darwin-arm64", "linux-x64"].some(
        (other) => other !== target && check.id.startsWith(`${other}.`),
      ),
  );
  if (
    result.localPassed &&
    readiness.errors.length === 0 &&
    localRemaining.length === 0
  )
    result.platformAcceptance = "passed";
  // Only the merged native platform result can establish formal acceptance.
} catch (error) {
  result.error = String(error);
  result.localPassed = false;
  result.platformAcceptance = "not_established";
  result.formalAcceptance = "not_established";
}
await save();
console.log(
  JSON.stringify({
    localPassed: result.localPassed,
    formalAcceptance: result.formalAcceptance,
    result: resultPath,
  }),
);
process.exitCode =
  result.localPassed && (values.phase !== "publish" || result.published)
    ? 0
    : 1;
