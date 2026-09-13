import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream, readFileSync, existsSync } from "node:fs";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, join, dirname, relative } from "node:path";
import { parseArgs } from "node:util";
import {
  fileSha256,
  inspectDesktopReadiness,
} from "./lib/desktop-readiness.mjs";
import {
  assertExecutedTests,
  canReuseTargetCheck,
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
    "visual-observation": { type: "string" },
    tag: { type: "string" },
    repository: { type: "string" },
  },
});
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
const executable =
  manifest.platform === "win32"
    ? join(resolve(values.installed), "Sestina Candidate.exe")
    : manifest.platform === "darwin"
      ? join(resolve(values.installed), "Contents/MacOS/Sestina Candidate")
      : join(resolve(values.installed), "sestina-candidate");
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
  manifest: relative(root, resolve(values.manifest)),
  environment,
  localPassed: false,
  formalAcceptance: "not_established",
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
    canReuseTargetCheck(prior, binding, proofHash())
  ) {
    const proof = JSON.parse(await readFile(proofPath, "utf8"));
    result.checks[id] = { ...prior, reused: true, proof };
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
        /^(?:apps|packages|integrations)\//.test(path) ||
        /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json|docs\/release\/THIRD-PARTY-NOTICES\.md|scripts\/(?:build-desktop\.mjs|package-desktop\.mjs|lib\/desktop-))/.test(
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
        scope: "shared-public-and-kernel-foundation-not-preview-installation",
      };
    },
    false,
    { SESTINA_VERIFICATION_OUTPUT: output },
  );
  await execute(
    "artifact",
    [
      join(root, "scripts/verify-desktop-artifact.mjs"),
      resolve(values.installed),
      resolve(values.manifest),
      sourceCommit,
    ],
    (log) => {
      const checked = lastJson(log);
      if (
        checked.passed !== true ||
        checked.identity.sourceCommit !== sourceCommit
      )
        throw Error("installed_identity_invalid");
      return { count: checked.verifiedFiles, identity: checked.identity };
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
  for (const id of ["journeys", "performance"]) {
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
        return { count: checked.cases.length, result: checked };
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
    if (
      lifecycle.passed !== true ||
      lifecycle.sourceCommit !== sourceCommit ||
      lifecycle.installerSha256 !== installerSha256 ||
      lifecycle.platform !== process.platform ||
      !lifecycle.cases?.length
    )
      throw Error("lifecycle_result_mismatch");
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
  result.localPassed = Object.values(result.checks).every(
    (check) => check.status === "passed" && check.count > 0,
  );
  const readiness = values.readiness
    ? inspectDesktopReadiness(
        await readJson(resolve(values.readiness)),
        dirname(resolve(values.readiness)),
      )
    : inspectDesktopReadiness({
        schema: 1,
        sourceCommit,
        artifacts: {
          [`${process.platform}-${process.arch}`]: {
            path: resolve(values.installer),
            sha256: installerSha256,
          },
        },
        observations: [],
      });
  result.remaining = readiness.checks.filter(
    (check) => check.status !== "passed",
  );
  for (const id of result.checks.lifecycle?.result?.notEstablished ?? [])
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
  if (
    result.localPassed &&
    readiness.remainingPrerequisitesSatisfied &&
    result.remaining.length === 0
  )
    result.formalAcceptance = "passed";
  // Code/local success never implies complete platform/native/signing acceptance.
  if (values.phase === "publish") {
    if (
      !values.tag ||
      !values.repository ||
      !result.localPassed ||
      !readiness.remainingPrerequisitesSatisfied ||
      result.remaining.length
    )
      throw Error("publication_acceptance_incomplete");
    if (git("rev-parse", `refs/tags/${values.tag}^{commit}`) !== sourceCommit)
      throw Error("publication_tag_source_mismatch");
    const release = JSON.parse(
      execFileSync(
        "gh",
        [
          "release",
          "view",
          values.tag,
          "--repo",
          values.repository,
          "--json",
          "tagName,isDraft,assets",
        ],
        { cwd: root, windowsHide: true, encoding: "utf8" },
      ),
    );
    if (release.isDraft || release.tagName !== values.tag)
      throw Error("publication_release_not_public");
    const attachment = release.assets.find(
      (item) => item.name === resolve(values.installer).split(/[\\/]/).at(-1),
    );
    if (!attachment || attachment.digest !== `sha256:${installerSha256}`)
      throw Error("publication_attachment_mismatch");
    const ref = JSON.parse(
      execFileSync(
        "gh",
        ["api", `repos/${values.repository}/commits/${values.tag}`],
        { cwd: root, windowsHide: true, encoding: "utf8" },
      ),
    );
    if (ref.sha !== sourceCommit)
      throw Error("publication_remote_tag_mismatch");
    result.published = true;
  }
} catch (error) {
  result.error = String(error);
  result.localPassed = false;
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
