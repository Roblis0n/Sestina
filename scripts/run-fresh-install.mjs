#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { extractZip } from "./lib/archive.mjs";
import { verifyReleaseDirectory } from "./lib/release-verifier.mjs";

function invariant(condition, message) { if (!condition) throw new Error(message); }
function sha256(buffer) { return createHash("sha256").update(buffer).digest("hex"); }

const rawArguments = process.argv.slice(2); let releaseArgument;
if (rawArguments.length === 0) releaseArgument = "release";
else if (rawArguments.length === 2 && rawArguments[0] === "--release-dir") releaseArgument = rawArguments[1];
else { process.stderr.write("Usage: node scripts/run-fresh-install.mjs [--release-dir <directory>]\n"); process.exit(2); }

const repositoryRoot = resolve(import.meta.dirname, ".."); const releaseDirectory = resolve(releaseArgument);
const verified = await verifyReleaseDirectory(releaseDirectory); const identity = verified.manifest.identity; const version = identity.version;
const npmTarball = join(releaseDirectory, `sestina-cli-${version}.tgz`); const zipBundle = join(releaseDirectory, `sestina-${version}.zip`);
const testRoot = await mkdtemp(join(tmpdir(), "Sestina RI42 fresh 安装 with spaces "));
const isolatedRoot = join(testRoot, "a-long-fresh-install-boundary", "第二层 research path", "third-level-with-a-deliberately-long-name");
const prefix = join(isolatedRoot, "npm prefix"); const cache = join(isolatedRoot, "npm cache"); const codexHome = join(isolatedRoot, "Codex isolated home");
const config = join(isolatedRoot, "npm-user.ini"); const marker = join(isolatedRoot, "network-guard-activations.txt");
const extracted = join(testRoot, "portable bundle"); const emptyProject = join(isolatedRoot, "empty project 研究");
const preload = join(repositoryRoot, "scripts", "no-network-preload.mjs");
const binDirectory = process.platform === "win32" ? prefix : join(prefix, "bin");
const shim = join(binDirectory, process.platform === "win32" ? "sestina.cmd" : "sestina");
const packageRoot = process.platform === "win32" ? join(prefix, "node_modules", "@sestina", "cli") : join(prefix, "lib", "node_modules", "@sestina", "cli");
const installedMain = join(packageRoot, "dist", "main.js"); const installedMcp = join(packageRoot, "dist", "mcp", "main.js");
const guardedEnv = {
  ...process.env,
  CODEX_HOME: codexHome,
  HOME: undefined,
  USERPROFILE: undefined,
  NO_COLOR: "1",
  NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
  SESTINA_NO_NETWORK_GUARD_MARKER: marker,
  NPM_CONFIG_USERCONFIG: config,
  NPM_CONFIG_PREFIX: prefix,
  NPM_CONFIG_CACHE: cache,
  NPM_CONFIG_OFFLINE: "true",
  NPM_CONFIG_AUDIT: "false",
  NPM_CONFIG_FUND: "false",
  NPM_CONFIG_UPDATE_NOTIFIER: "false",
  NPM_CONFIG_IGNORE_SCRIPTS: "true",
  PATH: `${binDirectory}${delimiter}${dirname(process.execPath)}`,
};

async function existingNpmCli() {
  const candidates = process.platform === "win32"
    ? [join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")]
    : [resolve(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"), join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")];
  for (const candidate of candidates) { try { await access(candidate, constants.R_OK); return candidate; } catch { /* continue */ } }
  throw new Error("npm_cli_not_found");
}

function assertNoNetwork(result, label) {
  const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (combined.includes("SESTINA_NETWORK_BLOCKED:")) throw new Error(`${label}_attempted_network`);
}

function runNode(entry, args, { cwd = isolatedRoot, allowedCodes = [0], label = "node_process" } = {}) {
  const result = spawnSync(process.execPath, [entry, ...args], { cwd, env: guardedEnv, encoding: "utf8", timeout: 60_000, windowsHide: true });
  assertNoNetwork(result, label); if (result.error || !allowedCodes.includes(result.status)) throw new Error(`${label}_failed:${result.status ?? "no_status"}`);
  return result;
}

async function runNpm(args, label) { return runNode(await existingNpmCli(), args, { label, allowedCodes: [0] }); }

function runInstalled(args, { cwd = isolatedRoot, allowedCodes = [0], label = "sestina" } = {}) {
  const executable = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : shim;
  const commandArguments = process.platform === "win32" ? ["/d", "/s", "/c", "call", shim, ...args] : args;
  const result = spawnSync(executable, commandArguments, { cwd, env: guardedEnv, encoding: "utf8", timeout: 60_000, windowsHide: true });
  assertNoNetwork(result, label); if (result.error || !allowedCodes.includes(result.status)) throw new Error(`${label}_failed:${result.status ?? "no_status"}`);
  return result;
}

function cliJson(args, options = {}) {
  const result = runInstalled([...args, "--json"], options); const line = result.stdout.split(/\r?\n/u).find((value) => value.trim().startsWith("{"));
  invariant(line !== undefined, `${options.label ?? "sestina"}_json_missing`); return JSON.parse(line);
}

function activeBrief(projectId, allowedPath, task) {
  return [
    `projectId: ${JSON.stringify(projectId)}`,
    `projectQuestion: ${JSON.stringify("How can a research revision make its genuine addition observable without replacing the question?")}`,
    "currentStage: revision",
    `currentTask: ${JSON.stringify(task)}`,
    "targetArtifacts: []",
    "fixedDecisions: []",
    `allowedChanges: ${JSON.stringify([{ target: { kind: "project_path", relativePath: allowedPath }, operations: ["add", "delete", "rewrite"] }])}`,
    "forbiddenChanges: []",
    `expectedDeltas: ${JSON.stringify([{ statement: "Name the evidence, boundary, or newly testable inference added by the revision.", scope: { target: { kind: "project_path", relativePath: allowedPath }, operations: ["rewrite"] } }])}`,
    `evidenceBoundaries: ${JSON.stringify([{ statement: "Elaborate wording alone is not new evidence.", scope: { target: { kind: "project_path", relativePath: allowedPath }, operations: ["rewrite"] }, forbiddenInferenceKinds: ["causal"] }])}`,
    `explicitNonGoals: ${JSON.stringify(["Call a model", "Upload research text", "Replace the research question"])}`,
    "",
  ].join("\n");
}

async function exerciseWorkflow(project, baselineRelative, candidateRelative, allowedPath, task, expectIssue, workflowLabel) {
  const label = (step) => `${workflowLabel}_${step}`;
  const initialized = cliJson(["init", "--project", project, "--title", "RI-42 fresh install study", "--yes"], { label: label("init") });
  await writeFile(join(project, ".sestina", "research-brief.yaml"), activeBrief(initialized.projectId, allowedPath, task), "utf8");
  cliJson(["brief", "edit", "--project", project, "--from", ".sestina/research-brief.yaml", "--yes"], { cwd: project, label: label("brief_edit") });
  const proposed = cliJson(["decision", "add", "--project", project, "--statement", "Elaborate wording alone is not a substantive addition.", "--rationale", "The research question requires observable additions.", "--scope", "project", "--reopen-condition", "A new contribution criterion is justified."], { label: "decision_add" });
  cliJson(["decision", "accept", proposed.decisionId, "--project", project, "--reason", "Preserve the revision boundary.", "--yes"], { label: "decision_accept" });
  const artifact = cliJson(["artifact", "add", "--project", project, "--kind", "section", "--path", baselineRelative], { cwd: project, label: "artifact_add" });
  const revision = cliJson(["revision", "add", artifact.artifactId, "--project", project, "--path", candidateRelative], { cwd: project, label: "revision_add" });
  const episode = cliJson(["episode", "start", "--project", project, "--artifact", artifact.artifactId, "--baseline", artifact.revisionId], { label: "episode_start" });
  cliJson(["episode", "submit", episode.episodeId, "--project", project, "--revision", revision.revisionId], { label: "episode_submit" });
  const review = cliJson(["review", "run", episode.episodeId, "--project", project, "--deterministic"], { label: "review", allowedCodes: [0, 5] });
  const issueList = cliJson(["issue", "list", "--project", project], { label: "issue_list" }); const issues = issueList.issues ?? [];
  invariant(expectIssue ? issues.length > 0 : issues.every((issue) => issue.severity !== "error"), expectIssue ? "expected_issue_missing" : "valid_workflow_has_error_issue");
  for (const issue of issues.filter((value) => value.status === "open" || value.status === "reopened")) {
    cliJson(["issue", "resolve", issue.id, "--project", project, "--reason", "Preserve the verifier record after a bounded correction.", "--evidence-id", "ri42-fresh-install", "--yes"], { label: "issue_resolve" });
  }
  cliJson(["episode", "waive", episode.episodeId, "--project", project, "--dimension", "evidence", "--scope", "project", "--reason", "Fresh-install verification does not claim semantic proof.", "--invalidation", "The evidence boundary changes.", "--yes"], { label: "episode_waive" });
  cliJson(["episode", "accept", episode.episodeId, "--project", project, "--reason", "Accept the locally recorded verifier outcome.", "--yes"], { label: "episode_accept" });
  const snapshot = cliJson(["snapshot", "create", episode.episodeId, "--project", project], { label: "snapshot_create" });
  invariant(snapshot.buildVersion === identity.releaseBuildId, "snapshot_release_build_id_drift");
  cliJson(["snapshot", "verify", snapshot.snapshotId, "--project", project], { label: "snapshot_verify" });
  cliJson(["report", "markdown", review.reviewRunId, "--project", project], { label: "report_markdown" });
  cliJson(["report", "json", review.reviewRunId, "--project", project], { label: "report_json" });
  cliJson(["capsule", "export", episode.episodeId, "--project", project], { label: "capsule_export" });
  cliJson(["privacy", "show", "--project", project], { label: "privacy" });
  cliJson(["data", "backup", "--project", project], { label: "backup" });
  const doctor = cliJson(["doctor", "--project", project], { label: "doctor" });
  invariant(doctor.version.releaseBuildId === identity.releaseBuildId && doctor.version.databaseSchemaVersion === identity.databaseSchemaVersion && doctor.version.reportSchemaVersion === identity.reportSchemaVersion, "doctor_release_identity_drift");
  return { decisionId: proposed.decisionId, episodeId: episode.episodeId, reviewRunId: review.reviewRunId, issueCount: issues.length };
}

async function projectDigest(root) {
  const records = [];
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const path = join(directory, entry.name); const name = relative(root, path).replaceAll("\\", "/");
      if (entry.isDirectory()) await visit(path); else if (entry.isFile()) { const bytes = await readFile(path); records.push(`${name}\0${bytes.length}\0${sha256(bytes)}`); }
      else throw new Error("project_contains_non_file_entry");
    }
  }
  await visit(root); return sha256(Buffer.from(records.join("\n")));
}

async function verifyMcp(project, expectedTask) {
  const child = (await import("node:child_process")).spawn(process.execPath, [installedMcp, "--project-root", project], { env: guardedEnv, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let stdout = ""; let stderr = ""; let nextId = 1; const pending = new Map(); child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; for (;;) { const newline = stdout.indexOf("\n"); if (newline < 0) break; const line = stdout.slice(0, newline).trim(); stdout = stdout.slice(newline + 1); if (!line) continue; const message = JSON.parse(line); const waiter = pending.get(message.id); if (waiter) { pending.delete(message.id); waiter(message); } } });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  function request(method, params = {}) { const id = nextId++; return new Promise((resolveRequest, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error(`mcp_timeout:${method}`)); }, 10_000); pending.set(id, (value) => { clearTimeout(timer); resolveRequest(value); }); child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`); }); }
  try {
    const initialized = await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "ri42-fresh-install", version: "1.0.0" } });
    invariant(initialized.result?.serverInfo?.version === identity.mcpServerVersion, "mcp_server_version_drift"); child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
    const tools = await request("tools/list"); invariant(JSON.stringify(tools.result?.tools?.map((tool) => tool.name)) === JSON.stringify(["health", "get_research_context"]), "mcp_tool_surface_drift");
    const resources = await request("resources/list"); invariant(JSON.stringify(resources.result?.resources?.map((resource) => resource.uri)) === JSON.stringify(["sestina://research/current-brief"]), "mcp_resource_surface_drift");
    const health = await request("tools/call", { name: "health", arguments: {} }); invariant(health.result?.structuredContent?.server?.version === identity.mcpServerVersion && health.result?.structuredContent?.mode === "read_only", "mcp_health_identity_drift");
    const context = await request("tools/call", { name: "get_research_context", arguments: {} }); invariant(context.result?.structuredContent?.currentTask === expectedTask, "mcp_context_missing");
    const resource = await request("resources/read", { uri: "sestina://research/current-brief" }); invariant(resource.result?.contents?.length === 1, "mcp_resource_missing");
    child.stdin.end(); const exit = await new Promise((resolveExit, reject) => { child.once("error", reject); child.once("exit", resolveExit); }); invariant(exit === 0, "mcp_exit_failed");
    invariant(stderr.includes('"event":"ready"') && !stderr.includes(project) && !stderr.includes(expectedTask) && !stderr.includes("SESTINA_NETWORK_BLOCKED:"), "mcp_stderr_boundary_failed");
  } finally { if (child.exitCode === null) child.kill(); }
}

try {
  await mkdir(isolatedRoot, { recursive: true });
  await writeFile(config, [`prefix=${prefix}`, `cache=${cache}`, "offline=true", "ignore-scripts=true", "audit=false", "fund=false", "update-notifier=false", "package-lock=false", "registry=https://registry.invalid/", ""].join("\n"), "utf8");
  await access(npmTarball, constants.R_OK); await access(zipBundle, constants.R_OK);
  invariant(!(await stat(packageRoot).catch(() => undefined)), "sestina_preinstalled_in_isolated_prefix");
  await runNpm(["install", "--global", npmTarball, "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock"], "npm_install");
  await access(shim, constants.R_OK); await access(installedMain, constants.R_OK); await access(installedMcp, constants.R_OK);
  const commandVersion = cliJson(["--version"], { label: "installed_sestina_version" }); invariant(commandVersion.releaseBuildId === identity.releaseBuildId, "installed_command_version_drift");
  await mkdir(emptyProject, { recursive: true }); const task = "RI42_PRIVATE_CANARY_MUST_ONLY_APPEAR_IN_EXPLICIT_MCP_CONTEXT";
  await mkdir(join(emptyProject, "outside"), { recursive: true });
  await writeFile(join(emptyProject, "outside", "baseline.md"), "# Baseline\n\nThe observed association is bounded.\n", "utf8");
  await writeFile(join(emptyProject, "outside", "candidate.md"), "# Baseline\n\nThe intervention certainly caused every outcome and proves an unrelated claim.\n", "utf8");
  const continuity = await exerciseWorkflow(emptyProject, "outside/baseline.md", "outside/candidate.md", "allowed", task, true, "empty_workflow");
  await extractZip(zipBundle, extracted); const quickstart = join(extracted, `sestina-${version}`, "examples", "06-release-quickstart");
  const quickWork = join(quickstart, "work"); await mkdir(quickWork); await cp(join(quickstart, "baseline.md"), join(quickWork, "baseline.md")); await cp(join(quickstart, "candidate.md"), join(quickWork, "candidate.md"));
  await exerciseWorkflow(quickstart, "work/baseline.md", "work/candidate.md", "work", "Verify one genuine argumentative addition from the sanitized release quickstart.", false, "quickstart_workflow");
  const connected = cliJson(["connect", "--project", emptyProject, "--host", "codex", "--yes"], { label: "connect" }); invariant(connected.state === "configured", "connect_failed");
  const statusResult = cliJson(["connection-status", "--project", emptyProject, "--host", "codex"], { label: "connection_status" }); invariant(statusResult.state === "configured" && statusResult.runtime?.status === "available", "connection_status_failed");
  const canonicalInstalledMcp = await realpath(installedMcp);
  const codexConfig = await readFile(join(emptyProject, ".codex", "config.toml"), "utf8"); invariant(codexConfig.includes(canonicalInstalledMcp.replaceAll("\\", "\\\\")), "connection_not_bound_to_installed_package");
  await verifyMcp(emptyProject, task);
  cliJson(["disconnect", "--project", emptyProject, "--host", "codex", "--yes"], { label: "disconnect" });
  cliJson(["connect", "--project", emptyProject, "--host", "codex", "--yes"], { label: "reconnect" });
  const beforeUninstall = await projectDigest(emptyProject);
  await runNpm(["uninstall", "--global", "@sestina/cli", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"], "npm_uninstall");
  invariant(!(await stat(packageRoot).catch(() => undefined)) && !(await stat(shim).catch(() => undefined)), "npm_uninstall_incomplete");
  invariant(await projectDigest(emptyProject) === beforeUninstall, "uninstall_changed_project_bytes");
  await runNpm(["install", "--global", npmTarball, "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock"], "npm_reinstall");
  const doctor = cliJson(["doctor", "--project", emptyProject], { label: "reinstall_doctor" }); invariant(doctor.version.releaseBuildId === identity.releaseBuildId, "reinstall_identity_drift");
  const decisions = cliJson(["decision", "list", "--project", emptyProject], { label: "reinstall_decisions" }); invariant(decisions.decisions?.some((decision) => decision.id === continuity.decisionId), "decision_missing_after_reinstall");
  const issues = cliJson(["issue", "list", "--project", emptyProject], { label: "reinstall_issues" }); invariant((issues.issues?.length ?? 0) >= continuity.issueCount, "issue_missing_after_reinstall");
  const episode = cliJson(["episode", "show", continuity.episodeId, "--project", emptyProject], { label: "reinstall_episode" }); invariant(episode.episodeId === continuity.episodeId || episode.id === continuity.episodeId, "episode_missing_after_reinstall");
  const activations = (await readFile(marker, "utf8")).trim().split(/\r?\n/u).filter(Boolean).length; invariant(activations >= 20, "network_guard_not_active_across_fresh_install");
  process.stdout.write(`${JSON.stringify({ ok: true, version, releaseBuildId: identity.releaseBuildId, platform: process.platform, architecture: process.arch, npmTarballOnly: true, offline: true, emptyWorkflow: true, bundledQuickstartWorkflow: true, mcp: { tools: 2, resources: 1, mode: "read_only" }, connectDisconnect: true, uninstallPreservedProjectBytes: true, reinstallContinuity: { decision: true, issue: true, episode: true }, guardedProcesses: activations })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "fresh_install_failed" })}\n`); process.exitCode = 1;
} finally {
  if (process.env.SESTINA_KEEP_FRESH_INSTALL !== "1") await rm(testRoot, { recursive: true, force: true });
}
