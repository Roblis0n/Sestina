#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const preload = join(repositoryRoot, "scripts", "no-network-preload.mjs");
const buildKit = join(repositoryRoot, "scripts", "build-pilot-kit.mjs");
const releaseRoot = join(repositoryRoot, "release");
const runtime = mkdtempSync(join(tmpdir(), "sestina-pilot-no-network-空格-"));
const guardMarker = join(runtime, "guard-active.txt");
const attemptMarker = join(runtime, "outbound-attempts.txt");
const canaryAttemptMarker = join(runtime, "canary-attempt.txt");
const researchCanary = "SYNTHETIC_PAPER_TEXT_RI43_MUST_NEVER_LEAVE_PROJECT";
const secretCanary = "SYNTHETIC_SECRET_RI43_MUST_NEVER_APPEAR";
const projectRoot = join(runtime, "研究项目 with spaces");
const privateRoot = join(runtime, "pilot-private");
const exportDirectory = join(runtime, "shareable exports");
const exportPath = join(exportDirectory, "synthetic-session.json");
const aggregateDirectory = join(runtime, "aggregate output");
const aggregateJson = join(aggregateDirectory, "aggregate.json");
const aggregateMarkdown = join(aggregateDirectory, "aggregate.md");
const kitRoot = join(runtime, "交付 kit with spaces");
const buildId = "86469e5ccc3c3b593084c6207545a4d8bfd1d23f19016d1d63973b49052c3085";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function filesUnder(directory, result = []) {
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) filesUnder(path, result);
    else result.push(path);
  }
  return result;
}

function digestTree(directory) {
  const result = {};
  for (const path of filesUnder(directory)) {
    const relativePath = path.slice(directory.length + 1).replaceAll("\\", "/");
    result[relativePath] = createHash("sha256").update(readFileSync(path)).digest("hex");
  }
  return result;
}

const guardedEnvironment = {
  ...process.env,
  NO_COLOR: "1",
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(preload).href}`.trim(),
  SESTINA_NO_NETWORK_GUARD_MARKER: guardMarker,
  SESTINA_NO_NETWORK_ATTEMPT_MARKER: attemptMarker,
};

function run(entry, args, environment = guardedEnvironment) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: repositoryRoot,
    env: environment,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 2_000_000,
  });
  invariant(result.status === 0, "pilot_guarded_command_failed");
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  invariant(!combined.includes(researchCanary), "pilot_research_canary_leaked");
  invariant(!combined.includes(secretCanary), "pilot_secret_canary_leaked");
  return result.stdout.trim();
}

try {
  mkdirSync(join(projectRoot, ".sestina"), { recursive: true });
  writeFileSync(join(projectRoot, "paper.md"), researchCanary, "utf8");
  writeFileSync(join(projectRoot, "RESEARCH-BRIEF.md"), `${researchCanary}\nbrief`, "utf8");
  writeFileSync(join(projectRoot, ".sestina", "state.db"), Buffer.from(secretCanary));
  const projectBefore = digestTree(projectRoot);

  const canaryEnvironment = {
    ...guardedEnvironment,
    SESTINA_NO_NETWORK_ATTEMPT_MARKER: canaryAttemptMarker,
  };
  const canary = spawnSync(
    process.execPath,
    ["-e", "require('node:net').connect({host:'127.0.0.1',port:9})"],
    {
      cwd: runtime,
      env: canaryEnvironment,
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
    },
  );
  invariant(canary.status !== 0, "pilot_network_canary_not_blocked");
  invariant(
    `${canary.stdout ?? ""}${canary.stderr ?? ""}`.includes("SESTINA_NETWORK_BLOCKED"),
    "pilot_network_canary_missing_block_signal",
  );
  invariant(
    existsSync(canaryAttemptMarker) && readFileSync(canaryAttemptMarker, "utf8").trim().length > 0,
    "pilot_network_canary_attempt_not_recorded",
  );

  run(buildKit, [releaseRoot, kitRoot]);
  const runner = join(kitRoot, "bin", "sestina-pilot.mjs");
  run(runner, ["verify-kit", "--kit-root", kitRoot]);
  const startOutput = run(runner, [
    "session",
    "start",
    "--private-root",
    privateRoot,
    "--participant-code",
    "SYNTHETIC-TEST",
    "--session-ordinal",
    "1",
    "--participant-role",
    "internal_test",
    "--host-entry",
    "cli",
    "--material-type",
    "paper",
    "--consent-version",
    "2026-08-21",
    "--consent-acknowledged",
    "true",
    "--release-version",
    "0.1.0",
    "--release-build-id",
    buildId,
    "--at",
    "2026-08-21T01:00:00.000Z",
  ]);
  const sessionId = JSON.parse(startOutput).sessionId;
  invariant(typeof sessionId === "string", "pilot_session_id_missing");
  const checkpoints = [
    ["install_started", "2026-08-21T01:01:00.000Z"],
    ["install_succeeded", "2026-08-21T01:03:00.000Z"],
    ["initialization_succeeded", "2026-08-21T01:08:00.000Z"],
    ["brief_completed", "2026-08-21T01:12:00.000Z"],
    ["episode_started", "2026-08-21T01:14:00.000Z"],
    ["episode_completed", "2026-08-21T01:45:00.000Z"],
    ["review_completed", "2026-08-21T01:48:00.000Z"],
  ];
  for (const [event, at] of checkpoints) {
    run(runner, [
      "session",
      "checkpoint",
      "--private-root",
      privateRoot,
      "--session-id",
      sessionId,
      "--event",
      event,
      "--exit-point",
      "none",
      "--at",
      at,
    ]);
  }
  run(runner, [
    "session",
    "finish",
    "--private-root",
    privateRoot,
    "--session-id",
    sessionId,
    "--exit-result",
    "completed",
    "--repeat-correction-impact",
    "uncertain",
    "--finding-necessary",
    "1",
    "--finding-unnecessary",
    "1",
    "--finding-uncertain",
    "1",
    "--brief-burden",
    "3",
    "--decision-burden",
    "3",
    "--issue-burden",
    "3",
    "--preferred-entry",
    "cli",
    "--ui-need",
    "uncertain",
    "--synthetic-case-discussion",
    "undecided",
    "--would-use-again",
    "uncertain",
    "--failure-observed",
    "false",
    "--negative-feedback-observed",
    "false",
    "--at",
    "2026-08-21T01:55:00.000Z",
  ]);
  run(runner, [
    "session",
    "show",
    "--private-root",
    privateRoot,
    "--session-id",
    sessionId,
  ]);
  run(runner, [
    "export",
    "--private-root",
    privateRoot,
    "--session-id",
    sessionId,
    "--output",
    exportPath,
  ]);
  run(runner, [
    "aggregate",
    "--input-dir",
    exportDirectory,
    "--json-output",
    aggregateJson,
    "--markdown-output",
    aggregateMarkdown,
  ]);
  run(runner, [
    "session",
    "delete",
    "--private-root",
    privateRoot,
    "--session-id",
    sessionId,
    "--yes",
    "true",
  ]);

  invariant(JSON.stringify(digestTree(projectRoot)) === JSON.stringify(projectBefore), "pilot_project_changed");
  for (const path of [
    exportPath,
    aggregateJson,
    aggregateMarkdown,
    join(kitRoot, "pilot-kit-manifest.json"),
    join(kitRoot, "SHA256SUMS"),
  ]) {
    const bytes = readFileSync(path, "utf8");
    invariant(!bytes.includes(researchCanary), "pilot_research_canary_leaked");
    invariant(!bytes.includes(secretCanary), "pilot_secret_canary_leaked");
    invariant(!bytes.includes(projectRoot), "pilot_project_path_leaked");
  }
  invariant(
    !existsSync(attemptMarker) || readFileSync(attemptMarker, "utf8").trim().length === 0,
    "pilot_outbound_attempt_observed",
  );
  invariant(
    existsSync(guardMarker) && readFileSync(guardMarker, "utf8").trim().length >= 1,
    "pilot_network_guard_not_loaded",
  );
  process.stdout.write(
    `${JSON.stringify({ ok: true, networkCanary: "blocked", outboundAttempts: 0, projectBytesChanged: false, syntheticOnly: true })}\n`,
  );
} finally {
  rmSync(runtime, { recursive: true, force: true });
}
