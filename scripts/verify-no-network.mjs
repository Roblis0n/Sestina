#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "apps", "cli", "dist", "main.js");
const mcp = join(root, "integrations", "mcp", "dist", "main.js");
const preload = join(root, "scripts", "no-network-preload.mjs");
const mcpVerifier = join(root, "scripts", "verify-mcp-offline.mjs");
const demo = join(root, "scripts", "run-offline-demos.mjs");
const runtime = mkdtempSync(join(tmpdir(), "sestina-no-network-"));
const marker = join(runtime, "guard-active.txt");
const project = join(runtime, "project");
const privateCanary = "RI41_PRIVATE_RESEARCH_TEXT_MUST_NOT_ENTER_LOGS";
const guardedEnv = {
  ...process.env,
  NO_COLOR: "1",
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(preload).href}`.trim(),
  SESTINA_NO_NETWORK_GUARD_MARKER: marker,
};

function invariant(condition, message) { if (!condition) throw new Error(message); }
function filesUnder(directory, result = []) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry); const value = statSync(path);
    if (value.isDirectory()) filesUnder(path, result); else result.push(path);
  }
  return result;
}
function run(entry, args, options = {}) {
  const result = spawnSync(process.execPath, [entry, ...args], { cwd: options.cwd ?? root, env: guardedEnv, encoding: "utf8", timeout: options.timeout ?? 60_000 });
  const blocked = result.stderr.match(/SESTINA_NETWORK_BLOCKED:([A-Za-z0-9_.-]+)/u)?.[1];
  if (blocked) throw new Error(`outbound attempt blocked: ${blocked}`);
  invariant((options.allowedCodes ?? [0]).includes(result.status), `${options.label ?? "guarded workflow"} failed with ${result.status ?? "no status"}`);
  invariant(!`${result.stdout}${result.stderr}`.includes(privateCanary), `${options.label ?? "guarded workflow"} leaked private research text outside an explicit content query`);
  invariant(!result.stderr.includes(project), `${options.label ?? "guarded workflow"} leaked the project path to stderr`);
  return result;
}
function cliJson(args, label, allowedCodes = [0]) {
  const result = run(cli, [...args, "--json"], { cwd: project, label, allowedCodes });
  const jsonLine = `${result.stdout}\n${result.stderr}`.split(/\r?\n/u).find((line) => line.trim().startsWith("{"));
  invariant(jsonLine !== undefined, `${label} returned no JSON`);
  return JSON.parse(jsonLine);
}

try {
  const canary = spawnSync(process.execPath, ["-e", 'require("node:net").connect(443, "example.com")'], { cwd: runtime, env: guardedEnv, encoding: "utf8", timeout: 10_000 });
  invariant(canary.status !== 0 && canary.stderr.includes("SESTINA_NETWORK_BLOCKED:net.connect"), "active network guard canary did not block net.connect");

  mkdirSync(project, { recursive: true });
  const privacy = cliJson(["privacy", "show", "--project", "."], "privacy CLI");
  invariant(privacy.networkDefault === "denied" && privacy.automaticTelemetry === false, "privacy manifest drifted");
  const initialized = cliJson(["init", "--project", ".", "--title", "Offline guard study", "--yes"], "init CLI");
  const brief = [
    `projectId: ${JSON.stringify(initialized.projectId)}`,
    `projectQuestion: ${JSON.stringify("Can active verification prove default workflows remain offline?")}`,
    "currentStage: revision",
    `currentTask: ${JSON.stringify(privateCanary)}`,
    "targetArtifacts: []", "fixedDecisions: []",
    `allowedChanges: ${JSON.stringify([{ target: { kind: "project_path", relativePath: "paper" }, operations: ["rewrite"] }])}`,
    "forbiddenChanges: []",
    `expectedDeltas: ${JSON.stringify([{ statement: "Verify offline operation", scope: { target: { kind: "project_path", relativePath: "paper" }, operations: ["rewrite"] } }])}`,
    "evidenceBoundaries: []", `explicitNonGoals: ${JSON.stringify(["Send research text over a network"])}`, "",
  ].join("\n");
  writeFileSync(join(project, ".sestina", "research-brief.yaml"), brief, "utf8");
  cliJson(["brief", "edit", "--project", ".", "--from", ".sestina/research-brief.yaml", "--yes"], "brief CLI");
  const backup = cliJson(["data", "backup", "--project", "."], "backup CLI");
  invariant(backup.networkUsed === false && backup.integrity === "ok", "backup CLI offline contract failed");
  const status = cliJson(["data", "status", "--project", "."], "status CLI");
  invariant(status.currentState === "healthy" && status.restoreAvailable === true, "status CLI recovery contract failed");
  const preview = cliJson(["data", "restore", backup.backupId, "--project", "."], "restore preview CLI", [7]);
  invariant(preview.confirmationRequired === true && preview.databaseIntegrity === "ok", "restore preview contract failed");
  const invalidRestore = cliJson(["data", "restore", "../../outside", "--project", "."], "invalid restore CLI", [2]);
  invariant(invalidRestore.error?.code === "invalid_input", "invalid restore did not fail closed");
  const doctor = cliJson(["doctor", "--project", "."], "doctor CLI");
  invariant(doctor.database?.integrity === "ok", "doctor offline workflow failed");
  const connected = cliJson(["connect", "--project", ".", "--host", "codex", "--yes"], "connect CLI");
  invariant(connected.state === "configured", "static connect failed offline");
  const connection = cliJson(["connection-status", "--project", ".", "--host", "codex"], "connection status CLI");
  invariant(connection.state === "configured" && connection.hostVerification === "unverified", "static connection status failed offline");
  const disconnected = cliJson(["disconnect", "--project", ".", "--host", "codex", "--yes"], "disconnect CLI");
  invariant(disconnected.state === "not_connected", "disconnect failed offline");

  const mcpResult = run(mcpVerifier, [mcp, project, privateCanary], { label: "MCP stdio workflow" });
  invariant(JSON.parse(mcpResult.stdout.trim()).mcp === true, "MCP offline workflow failed");
  const demoResult = run(demo, [], { label: "offline demos", timeout: 120_000 });
  const demoLines = demoResult.stdout.trim().split(/\r?\n/u).map((line) => JSON.parse(line));
  invariant(demoLines.at(-1)?.offline === true && demoLines.at(-1)?.demos === 4, "offline demos did not complete");

  const activations = readFileSync(marker, "utf8").trim().split(/\r?\n/u).filter(Boolean);
  invariant(activations.length >= 8, "network guard was not active across child workflows");
  const backgroundArtifacts = filesUnder(project).filter((path) => /\.(?:log|dmp|crash)$/i.test(path) || /crash[-_]?report|(?:upload|retry)[-_]?queue/i.test(path));
  invariant(backgroundArtifacts.length === 0, "default workflows created a background log, crash artifact, or upload queue");
  process.stdout.write(`${JSON.stringify({ offlineVerified: true, guardCanary: "blocked", cli: true, mcp: true, demos: 4, guardedProcesses: activations.length, networkAttemptsObserved: 1 })}\n`);
} catch (error) {
  process.stderr.write(`No-network verification failed: ${error instanceof Error ? error.message : "unknown failure"}\n`);
  process.exitCode = 1;
} finally {
  rmSync(runtime, { recursive: true, force: true });
}
