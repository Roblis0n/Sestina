#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { constants, readFileSync } from "node:fs";
import { request as requestHttp } from "node:http";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { extractZip } from "./lib/archive.mjs";
import { verifyReleaseDirectory } from "./lib/release-verifier.mjs";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function jsonLine(output, label) {
  const line = output
    .split(/\r?\n/u)
    .reverse()
    .find((candidate) => candidate.trim().startsWith("{"));
  invariant(line !== undefined, label + "_json_missing");
  return JSON.parse(line);
}

const rawArguments = process.argv.slice(2);
let releaseArgument;
if (rawArguments.length === 0) releaseArgument = "release";
else if (rawArguments.length === 2 && rawArguments[0] === "--release-dir")
  releaseArgument = rawArguments[1];
else {
  process.stderr.write(
    "Usage: node scripts/run-fresh-install.mjs [--release-dir <directory>]\n",
  );
  process.exit(2);
}

const repositoryRoot = resolve(import.meta.dirname, "..");
const releaseDirectory = resolve(releaseArgument);
const verified = await verifyReleaseDirectory(releaseDirectory);
const manifest = verified.manifest;
const identity = manifest.identity;
const zipArtifact = manifest.artifacts.find(
  (artifact) => artifact.kind === "platform-zip",
);
invariant(zipArtifact !== undefined, "platform_zip_missing");
const zipBundle = join(releaseDirectory, zipArtifact.file);
const testRoot = await mkdtemp(
  join(tmpdir(), "Sestina RI53 lifecycle 安装 with spaces "),
);
const installDirectory = join(
  testRoot,
  "installed product",
  "第二层 Research Room",
  "long-boundary-for-real-artifact-extraction",
);
const configRoot = join(testRoot, "isolated app configuration");
const projectsRoot = join(testRoot, "local research projects");
const marker = join(testRoot, "network-guard-activations.txt");
const attemptMarker = join(testRoot, "network-guard-attempts.txt");
const preload = join(repositoryRoot, "scripts", "no-network-preload.mjs");
const viteNode = join(
  repositoryRoot,
  "node_modules",
  "vite-node",
  "vite-node.mjs",
);
const fixtureScript = join(
  repositoryRoot,
  "scripts",
  "prepare-release-lifecycle-fixture.mjs",
);
let artifactRoot = join(installDirectory, manifest.contents.releaseBundleRoot);
let running;
const expectedGuardedProcessIds = [];

const guardedEnvironment = {
  ...process.env,
  NO_COLOR: "1",
  NODE_OPTIONS: "--import=" + pathToFileURL(preload).href,
  SESTINA_NO_NETWORK_GUARD_MARKER: marker,
  SESTINA_NO_NETWORK_ATTEMPT_MARKER: attemptMarker,
  SESTINA_USE_ENV_BACKEND: "false",
};
if (process.platform === "linux") {
  delete guardedEnvironment.DBUS_SESSION_BUS_ADDRESS;
  guardedEnvironment.XDG_RUNTIME_DIR = join(
    configRoot,
    "runtime-without-session-bus",
  );
}

function checkedProcess(entry, args, label, timeout = 60_000) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: repositoryRoot,
    env: guardedEnvironment,
    encoding: "utf8",
    timeout,
    windowsHide: true,
  });
  assertNetworkGuardActive(result.pid, label);
  const combined = String(result.stdout ?? "") + String(result.stderr ?? "");
  invariant(
    !combined.includes("SESTINA_NETWORK_BLOCKED:"),
    label + "_attempted_network",
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      label +
        "_failed:" +
        String(result.status ?? "no_status") +
        ":" +
        combined.slice(-2_000),
    );
  }
  return result;
}

function activatedProcessIds() {
  try {
    return new Set(
      readFileSync(marker, "utf8")
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((value) => Number.parseInt(value, 10))
        .filter(Number.isInteger),
    );
  } catch {
    return new Set();
  }
}

function assertNetworkGuardActive(pid, label) {
  invariant(Number.isInteger(pid) && pid > 0, label + "_pid_missing");
  invariant(
    activatedProcessIds().has(pid),
    label + "_network_guard_not_active",
  );
  expectedGuardedProcessIds.push(pid);
}

async function installArtifact() {
  await extractZip(zipBundle, installDirectory);
  artifactRoot = join(installDirectory, manifest.contents.releaseBundleRoot);
  await access(join(artifactRoot, "start.mjs"), constants.R_OK);
  await access(join(artifactRoot, "app", "main.js"), constants.R_OK);
  await access(
    join(artifactRoot, "app", "client", "index.html"),
    constants.R_OK,
  );
}

function verifyInstalledIdentity() {
  const result = checkedProcess(
    join(artifactRoot, "start.mjs"),
    ["--version", "--json"],
    "artifact_version",
  );
  const installed = jsonLine(result.stdout, "artifact_version");
  invariant(
    installed.product === "Sestina Research Room",
    "artifact_product_identity_drift",
  );
  invariant(
    installed.package === "@sestina/research-room",
    "artifact_package_identity_drift",
  );
  invariant(
    installed.releaseBuildId === identity.releaseBuildId,
    "artifact_release_build_id_drift",
  );
  invariant(
    installed.platform === process.platform &&
      installed.architecture === process.arch,
    "artifact_platform_identity_drift",
  );
}

async function startArtifact() {
  const child = spawn(
    process.execPath,
    [
      join(artifactRoot, "start.mjs"),
      "--port",
      "0",
      "--config-root",
      configRoot,
    ],
    {
      cwd: artifactRoot,
      env: guardedEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const origin = await new Promise((resolveOrigin, rejectOrigin) => {
    const timeout = setTimeout(
      () =>
        rejectOrigin(
          new Error("artifact_start_timeout:" + stderr.slice(-1_000)),
        ),
      20_000,
    );
    const finish = (callback) => {
      clearTimeout(timeout);
      child.stdout.removeListener("data", onData);
      child.removeListener("exit", onExit);
      callback();
    };
    const onData = (chunk) => {
      stdout += chunk;
      const value = /Sestina Research Room: (http:\/\/127\.0\.0\.1:\d+)/u.exec(
        stdout,
      )?.[1];
      if (value) finish(() => resolveOrigin(value));
    };
    const onExit = (code) =>
      finish(() =>
        rejectOrigin(
          new Error(
            "artifact_start_failed:" +
              String(code) +
              ":" +
              stderr.slice(-1_000),
          ),
        ),
      );
    child.stdout.on("data", onData);
    child.once("exit", onExit);
  });
  assertNetworkGuardActive(child.pid, "artifact_server");
  running = { child, origin, stderr: () => stderr };
  return running;
}

async function stopArtifact(instance = running) {
  if (instance === undefined) return;
  if (running === instance) running = undefined;
  if (instance.child.exitCode !== null || instance.child.signalCode !== null)
    return;
  const gracefulExit = once(instance.child, "exit");
  instance.child.kill();
  const stopped = await Promise.race([
    gracefulExit.then(() => true),
    new Promise((resolveWait) => setTimeout(() => resolveWait(false), 8_000)),
  ]);
  if (
    !stopped &&
    instance.child.exitCode === null &&
    instance.child.signalCode === null
  ) {
    const forcedExit = once(instance.child, "exit");
    instance.child.kill("SIGKILL");
    await forcedExit;
  }
  invariant(
    !instance.stderr().includes("SESTINA_NETWORK_BLOCKED:"),
    "artifact_server_attempted_network",
  );
}

async function requestJson(origin, method, path, body, token) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token === undefined ? {} : { "x-sestina-session": token }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("invalid_json_response:" + method + ":" + path);
  }
  return { response, body: payload };
}

function valueOf(result, label) {
  invariant(
    result.response.ok && result.body?.ok === true,
    label +
      "_failed:" +
      String(result.response.status) +
      ":" +
      String(result.body?.error?.code ?? "unknown"),
  );
  return result.body.value;
}

async function status(origin) {
  return valueOf(await requestJson(origin, "GET", "/api/status"), "status");
}

async function post(origin, token, path, body, label) {
  return valueOf(await requestJson(origin, "POST", path, body, token), label);
}

async function assertHostRejected(origin) {
  const target = new URL(origin);
  const statusCode = await new Promise((resolveStatus, rejectStatus) => {
    const request = requestHttp(
      {
        hostname: "127.0.0.1",
        port: Number(target.port),
        path: "/api/status",
        method: "GET",
        headers: { host: "external.example.invalid" },
      },
      (response) => {
        response.resume();
        response.once("end", () => resolveStatus(response.statusCode));
      },
    );
    request.once("error", rejectStatus);
    request.setTimeout(10_000, () =>
      request.destroy(new Error("host_rejection_timeout")),
    );
    request.end();
  });
  invariant(statusCode === 421, "non_loopback_host_not_rejected");
}

async function projectDigest(root) {
  const records = [];
  async function visit(directory) {
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const path = join(directory, entry.name);
      const name = relative(root, path).replaceAll("\\", "/");
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const bytes = await readFile(path);
        records.push(name + "\0" + String(bytes.length) + "\0" + sha256(bytes));
      } else throw new Error("project_contains_link_or_special_entry");
    }
  }
  await visit(root);
  return sha256(Buffer.from(records.join("\n")));
}

async function prepareFixture(root, mode) {
  await mkdir(root, { recursive: true });
  const result = checkedProcess(
    viteNode,
    [fixtureScript, "--root", root, "--mode", mode],
    "fixture_" + mode,
    90_000,
  );
  const fixture = jsonLine(result.stdout, "fixture_" + mode);
  invariant(
    fixture.ok === true && fixture.mode === mode,
    "fixture_identity_drift:" + mode,
  );
  return fixture;
}

async function listContains(origin, path, expectedId, label) {
  const list = valueOf(await requestJson(origin, "GET", path), label);
  invariant(
    Array.isArray(list.items) &&
      list.items.some((item) => item?.id === expectedId),
    label + "_continuity_missing",
  );
}

async function verifyCanonicalContinuity(origin, fixture) {
  await listContains(
    origin,
    "/api/project/decisions?limit=50",
    fixture.decisionId,
    "decision",
  );
  await listContains(
    origin,
    "/api/project/issues?limit=50",
    fixture.issueId,
    "issue",
  );
  await listContains(
    origin,
    "/api/project/episodes?limit=50",
    fixture.episodeId,
    "episode",
  );
  await listContains(
    origin,
    "/api/project/receipts?limit=50",
    fixture.receiptId,
    "receipt",
  );
  const state = valueOf(
    await requestJson(origin, "GET", "/api/state"),
    "canonical_state",
  );
  invariant(
    state.project?.id === fixture.projectId,
    "project_continuity_missing",
  );
  invariant(
    state.brief?.currentTask === fixture.currentTask,
    "brief_continuity_missing",
  );
  invariant(
    state.currentEpisode?.id === fixture.episodeId,
    "current_episode_continuity_missing",
  );
  invariant(
    state.decisions?.some((item) => item.id === fixture.decisionId),
    "active_decision_continuity_missing",
  );
  invariant(
    state.issues?.some((item) => item.id === fixture.issueId),
    "open_issue_continuity_missing",
  );
  invariant(
    state.receipts?.some((item) => item.id === fixture.receiptId),
    "state_receipt_continuity_missing",
  );
}

async function exerciseFirstLaunch(instance, projectRoot) {
  const shell = await fetch(instance.origin + "/", {
    signal: AbortSignal.timeout(20_000),
  });
  const html = await shell.text();
  invariant(
    shell.status === 200 && html.includes("Sestina"),
    "research_room_shell_missing",
  );
  invariant(
    shell.headers.get("x-frame-options") === "DENY",
    "frame_protection_missing",
  );
  invariant(
    shell.headers
      .get("content-security-policy")
      ?.includes("default-src 'self'"),
    "content_security_policy_missing",
  );
  await assertHostRejected(instance.origin);
  const initial = await status(instance.origin);
  invariant(
    initial.localOnly === true &&
      initial.telemetry === false &&
      initial.languagePreference === null,
    "first_launch_boundary_drift",
  );
  const unauthorized = await requestJson(
    instance.origin,
    "POST",
    "/api/preferences/language",
    { language: "en" },
  );
  invariant(
    unauthorized.response.status === 403 &&
      unauthorized.body?.error?.code === "explicit_action_required",
    "session_mutation_not_rejected",
  );
  await post(
    instance.origin,
    initial.sessionToken,
    "/api/preferences/language",
    { language: "en" },
    "language_preference",
  );
  const provider = valueOf(
    await requestJson(instance.origin, "GET", "/api/provider"),
    "provider_status",
  );
  invariant(
    provider.mode === "offline_ledger" && provider.secretConfigured === false,
    "provider_not_fail_closed_offline",
  );

  await mkdir(projectRoot, { recursive: true });
  const opened = await post(
    instance.origin,
    initial.sessionToken,
    "/api/project/open",
    {
      projectPath: projectRoot,
      initializeIfNeeded: true,
      projectTitle: "RI-53 fresh Research Room",
    },
    "new_project",
  );
  invariant(
    opened.initialized === true && opened.recoveryRequired === false,
    "new_project_initialization_drift",
  );
  await post(
    instance.origin,
    initial.sessionToken,
    "/api/project/brief",
    {
      projectQuestion:
        "Can the packaged Research Room preserve a local project through restore and reinstall?",
      currentTask: "Verify exact local lifecycle continuity.",
    },
    "activate_brief",
  );
  const brief = valueOf(
    await requestJson(instance.origin, "GET", "/api/project/brief"),
    "brief_workspace",
  );
  const recorded = await post(
    instance.origin,
    initial.sessionToken,
    "/api/commands/decisions/record",
    {
      commandType: "record_decision",
      projectId: opened.project.id,
      expectedVersion: brief.entityVersion,
      effectiveBriefVersionId: brief.active.id,
      statement:
        "Recovery must require exact preview and explicit confirmation.",
      scope: { kind: "project" },
      rationale: "A restore changes authoritative local state.",
      reopenConditions: ["The recovery binding contract changes."],
      reason: "Record the RI-53 lifecycle authority boundary.",
      confirmed: true,
    },
    "record_decision",
  );
  const accepted = await post(
    instance.origin,
    initial.sessionToken,
    "/api/commands/decisions/transition",
    {
      commandType: "transition_decision",
      projectId: opened.project.id,
      decisionId: recorded.id,
      expectedVersion: recorded.version,
      target: "accepted",
      reason: "Accept the explicit recovery boundary.",
      confirmed: true,
    },
    "accept_decision",
  );
  const preparedReview = await post(
    instance.origin,
    initial.sessionToken,
    "/api/reviews/prepare",
    {
      suggestion: "Keep all release verification local and evidence-bounded.",
      evidenceClass: "owner_scenario",
      selectedMemoryItemIds: [],
    },
    "prepare_review",
  );
  const analyzed = await post(
    instance.origin,
    initial.sessionToken,
    "/api/reviews/analyze",
    {
      reviewId: preparedReview.reviewId,
      confirmationNonce: preparedReview.confirmationNonce,
      manifestHash: preparedReview.manifestHash,
    },
    "analyze_review",
  );
  invariant(
    analyzed.providerStatus === "ledger_only" &&
      analyzed.manifest?.networkUsed === false,
    "ledger_only_boundary_drift",
  );
  const receipt = await post(
    instance.origin,
    initial.sessionToken,
    "/api/reviews/commit",
    {
      projectId: opened.project.id,
      reviewId: analyzed.reviewId,
      authorityNonce: analyzed.authorityNonce,
      expectedStateBinding: analyzed.stateBinding,
      disposition: "deferred",
      reason:
        "Defer semantic adoption; this lifecycle proves only local product behavior.",
    },
    "commit_deferred_receipt",
  );
  const backup = await post(
    instance.origin,
    initial.sessionToken,
    "/api/project/recovery/backup",
    {},
    "create_backup",
  );
  invariant(
    backup.kind === "manual" &&
      backup.integrity === "ok" &&
      backup.briefBinding === "matched" &&
      backup.networkUsed === false,
    "backup_contract_drift",
  );
  const preview = await post(
    instance.origin,
    initial.sessionToken,
    "/api/project/recovery/restore/preview",
    { backupId: backup.backupId },
    "preview_restore",
  );
  invariant(
    preview.confirmationRequired === true &&
      preview.compatibility === "supported" &&
      /^[0-9a-f]{64}$/u.test(preview.manifestHash),
    "restore_preview_contract_drift",
  );
  const restored = await post(
    instance.origin,
    initial.sessionToken,
    "/api/project/recovery/restore",
    {
      backupId: backup.backupId,
      confirmationNonce: preview.confirmationNonce,
      expectedStateBinding: preview.stateBinding,
      confirmed: true,
    },
    "execute_restore",
  );
  invariant(
    restored.restored === true &&
      restored.reopened === true &&
      restored.confirmationConsumed === true &&
      restored.rollback?.currentStatePreserved === true,
    "restore_result_contract_drift",
  );
  const replay = await requestJson(
    instance.origin,
    "POST",
    "/api/project/recovery/restore",
    {
      backupId: backup.backupId,
      confirmationNonce: preview.confirmationNonce,
      expectedStateBinding: preview.stateBinding,
      confirmed: true,
    },
    initial.sessionToken,
  );
  invariant(
    replay.response.status === 409 &&
      replay.body?.error?.code === "confirmation_replayed",
    "restore_confirmation_replay_not_rejected",
  );
  await listContains(
    instance.origin,
    "/api/project/decisions?limit=50",
    accepted.id,
    "fresh_decision",
  );
  await listContains(
    instance.origin,
    "/api/project/receipts?limit=50",
    receipt.id,
    "fresh_receipt",
  );
  return {
    projectId: opened.project.id,
    decisionId: accepted.id,
    receiptId: receipt.id,
    secureStorage: provider.secureStorage,
  };
}

async function verifyFreshContinuity(origin, continuity) {
  await listContains(
    origin,
    "/api/project/decisions?limit=50",
    continuity.decisionId,
    "reinstall_fresh_decision",
  );
  await listContains(
    origin,
    "/api/project/receipts?limit=50",
    continuity.receiptId,
    "reinstall_fresh_receipt",
  );
}

try {
  await Promise.all([
    mkdir(configRoot, { recursive: true }),
    mkdir(projectsRoot, { recursive: true }),
    mkdir(guardedEnvironment.XDG_RUNTIME_DIR ?? join(configRoot, "runtime"), {
      recursive: true,
    }),
  ]);
  await access(zipBundle, constants.R_OK);
  await access(preload, constants.R_OK);
  await access(viteNode, constants.R_OK);
  await installArtifact();
  verifyInstalledIdentity();

  let instance = await startArtifact();
  const freshRoot = join(projectsRoot, "01 fresh project 新建");
  const fresh = await exerciseFirstLaunch(instance, freshRoot);

  const upgradeRoot = join(projectsRoot, "02 schema 16 upgrade 升级");
  const upgrade = await prepareFixture(upgradeRoot, "upgrade");
  const upgraded = await post(
    instance.origin,
    (await status(instance.origin)).sessionToken,
    "/api/project/open",
    { projectPath: upgradeRoot, initializeIfNeeded: false },
    "open_schema16",
  );
  invariant(
    upgraded.project?.id === upgrade.projectId &&
      upgraded.recoveryRequired === false,
    "schema16_upgrade_open_failed",
  );
  const upgradedRecovery = valueOf(
    await requestJson(instance.origin, "GET", "/api/project/recovery"),
    "upgraded_recovery_status",
  );
  invariant(
    upgradedRecovery.schema?.version === 20 &&
      upgradedRecovery.schema?.status === "recognized",
    "schema_upgrade_not_completed",
  );
  invariant(
    upgradedRecovery.backups?.some(
      (backup) =>
        backup.kind === "pre_upgrade" &&
        backup.databaseSchemaVersion === 16 &&
        backup.valid === true,
    ),
    "pre_upgrade_bundle_missing",
  );
  await verifyCanonicalContinuity(instance.origin, upgrade);

  await stopArtifact(instance);
  instance = await startArtifact();
  const restartStatus = await status(instance.origin);
  invariant(
    restartStatus.languagePreference === "en",
    "language_preference_restart_continuity_missing",
  );
  await post(
    instance.origin,
    restartStatus.sessionToken,
    "/api/project/open",
    { projectPath: upgradeRoot, initializeIfNeeded: false },
    "restart_open_upgrade",
  );
  await verifyCanonicalContinuity(instance.origin, upgrade);

  const failureRoot = join(projectsRoot, "03 migration failure 失败");
  await prepareFixture(failureRoot, "migration-failure");
  const failureOpen = await post(
    instance.origin,
    restartStatus.sessionToken,
    "/api/project/open",
    { projectPath: failureRoot, initializeIfNeeded: false },
    "open_migration_failure",
  );
  invariant(
    failureOpen.recoveryRequired === true,
    "migration_failure_did_not_fail_closed",
  );
  const failedStatus = valueOf(
    await requestJson(instance.origin, "GET", "/api/project/recovery"),
    "migration_failure_status",
  );
  invariant(
    failedStatus.schema?.status === "migration_failed" &&
      failedStatus.schema?.version === 16 &&
      failedStatus.schema?.failedVersion === 17,
    "migration_failure_status_drift",
  );
  const failedBundles = failedStatus.backups.filter(
    (backup) =>
      backup.kind === "pre_upgrade" &&
      backup.databaseSchemaVersion === 16 &&
      backup.valid === true,
  ).length;
  invariant(failedBundles === 1, "migration_failure_pre_upgrade_bundle_drift");
  const failedDatabase = join(failureRoot, ".sestina", "state.sqlite");
  const failedDigest = sha256(await readFile(failedDatabase));

  await stopArtifact(instance);
  instance = await startArtifact();
  const failureRestart = await status(instance.origin);
  const failureReopened = await post(
    instance.origin,
    failureRestart.sessionToken,
    "/api/project/open",
    { projectPath: failureRoot, initializeIfNeeded: false },
    "restart_migration_failure",
  );
  invariant(
    failureReopened.recoveryRequired === true,
    "migration_failure_automatic_retry_detected",
  );
  const failedAgain = valueOf(
    await requestJson(instance.origin, "GET", "/api/project/recovery"),
    "migration_failure_restart_status",
  );
  invariant(
    failedAgain.schema?.status === "migration_failed" &&
      failedAgain.backups.filter((backup) => backup.kind === "pre_upgrade")
        .length === failedBundles,
    "migration_failure_retry_state_drift",
  );
  invariant(
    sha256(await readFile(failedDatabase)) === failedDigest,
    "migration_failure_restart_mutated_database",
  );

  const futureRoot = join(projectsRoot, "04 future schema 拒绝");
  await prepareFixture(futureRoot, "future");
  const futureDatabase = join(futureRoot, ".sestina", "state.sqlite");
  const futureDigest = sha256(await readFile(futureDatabase));
  const futureOpen = await post(
    instance.origin,
    failureRestart.sessionToken,
    "/api/project/open",
    { projectPath: futureRoot, initializeIfNeeded: false },
    "open_future_schema",
  );
  invariant(futureOpen.recoveryRequired === true, "future_schema_not_refused");
  const futureStatus = valueOf(
    await requestJson(instance.origin, "GET", "/api/project/recovery"),
    "future_schema_status",
  );
  invariant(
    futureStatus.schema?.status === "too_new" &&
      futureStatus.schema?.version === 21 &&
      futureStatus.schema?.supportedVersion === 20,
    "future_schema_status_drift",
  );
  invariant(
    sha256(await readFile(futureDatabase)) === futureDigest,
    "future_schema_database_mutated",
  );

  await stopArtifact(instance);
  const projectRoots = [freshRoot, upgradeRoot, failureRoot, futureRoot];
  const beforeUninstall = await Promise.all(projectRoots.map(projectDigest));
  const canonicalTestRoot = await realpath(testRoot);
  const canonicalInstall = await realpath(installDirectory);
  const removalBoundary = relative(canonicalTestRoot, canonicalInstall);
  invariant(
    removalBoundary !== "" && !removalBoundary.startsWith(".."),
    "unsafe_uninstall_boundary",
  );
  await rm(canonicalInstall, { recursive: true, force: true });
  invariant(
    !(await stat(canonicalInstall).catch(() => undefined)),
    "artifact_uninstall_incomplete",
  );
  const afterUninstall = await Promise.all(projectRoots.map(projectDigest));
  invariant(
    JSON.stringify(beforeUninstall) === JSON.stringify(afterUninstall),
    "uninstall_changed_project_bytes",
  );

  await installArtifact();
  verifyInstalledIdentity();
  instance = await startArtifact();
  const reinstallStatus = await status(instance.origin);
  invariant(
    reinstallStatus.languagePreference === "en",
    "reinstall_configuration_continuity_missing",
  );
  await post(
    instance.origin,
    reinstallStatus.sessionToken,
    "/api/project/open",
    { projectPath: freshRoot, initializeIfNeeded: false },
    "reinstall_open_fresh",
  );
  await verifyFreshContinuity(instance.origin, fresh);
  await post(
    instance.origin,
    reinstallStatus.sessionToken,
    "/api/project/open",
    { projectPath: upgradeRoot, initializeIfNeeded: false },
    "reinstall_open_upgrade",
  );
  await verifyCanonicalContinuity(instance.origin, upgrade);
  await stopArtifact(instance);

  const attempts = (
    await readFile(attemptMarker, "utf8").catch(() => Buffer.from(""))
  )
    .toString("utf8")
    .trim();
  invariant(attempts === "", "hidden_network_attempt_detected");
  const activations = (await readFile(marker, "utf8"))
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean).length;
  const activatedIds = activatedProcessIds();
  invariant(
    expectedGuardedProcessIds.length > 0 &&
      expectedGuardedProcessIds.every((pid) => activatedIds.has(pid)),
    "network_guard_not_active_across_lifecycle",
  );
  process.stdout.write(
    JSON.stringify({
      ok: true,
      product: identity.product,
      version: identity.version,
      releaseBuildId: identity.releaseBuildId,
      platform: process.platform,
      architecture: process.arch,
      artifact: zipArtifact.file,
      firstLaunch: true,
      newProject: true,
      loopbackOnly: true,
      sessionMutationGuard: true,
      providerMode: "offline_ledger",
      secureStorage: fresh.secureStorage,
      backupRestore: {
        verified: true,
        explicitConfirmation: true,
        replayRejected: true,
      },
      supportedUpgrade: {
        from: 16,
        to: 20,
        preUpgradeBundle: true,
        continuity: ["Brief", "Decision", "Issue", "Episode", "Receipt"],
      },
      migrationFailure: {
        failedVersion: 17,
        failClosed: true,
        automaticRetry: false,
      },
      futureSchema: {
        version: 21,
        failClosed: true,
        databaseBytesPreserved: true,
      },
      restartContinuity: true,
      uninstallPreservedProjectBytes: true,
      reinstallContinuity: true,
      guardedProcesses: activations,
      guardedLifecycleProcesses: expectedGuardedProcessIds.length,
      networkAttempts: 0,
    }) + "\n",
  );
} catch (error) {
  process.stderr.write(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : "ri53_lifecycle_failed",
    }) + "\n",
  );
  process.exitCode = 1;
} finally {
  await stopArtifact().catch(() => undefined);
  const canonicalRoot = resolve(testRoot);
  const temporaryBase = resolve(tmpdir());
  const boundary = relative(temporaryBase, canonicalRoot);
  if (boundary !== "" && !boundary.startsWith(".."))
    await rm(canonicalRoot, { recursive: true, force: true });
}
