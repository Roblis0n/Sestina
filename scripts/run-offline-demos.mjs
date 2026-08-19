#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(root, "apps", "cli", "dist", "main.js");
const examplesRoot = join(root, "examples");
const runtimeRoot = mkdtempSync(join(tmpdir(), "sestina-offline-demos-"));

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function command(project, args, allowedCodes = [0]) {
  const result = spawnSync(process.execPath, [cliPath, ...args, "--project", ".", "--json"], {
    cwd: project,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  const output = result.stdout.trim();
  let json;
  try { json = output.length > 0 ? JSON.parse(output) : undefined; }
  catch { throw new Error(`CLI emitted non-JSON output for ${args.slice(0, 2).join(" ")}`); }
  invariant(allowedCodes.includes(result.status ?? -1), `CLI ${args.slice(0, 2).join(" ")} exited ${result.status ?? -1}`);
  invariant(json !== undefined, `CLI ${args.slice(0, 2).join(" ")} returned no result`);
  return { code: result.status, json };
}

function briefYaml(projectId, input) {
  return [
    `projectId: ${JSON.stringify(projectId)}`,
    `projectQuestion: ${JSON.stringify(input.projectQuestion)}`,
    "currentStage: revision",
    `currentTask: ${JSON.stringify(input.currentTask)}`,
    "targetArtifacts: []",
    "fixedDecisions: []",
    `allowedChanges: ${JSON.stringify([{ target: { kind: "project_path", relativePath: input.allowedPath }, operations: ["add", "delete", "rewrite"] }])}`,
    "forbiddenChanges: []",
    `expectedDeltas: ${JSON.stringify([{ statement: input.expectedDelta, scope: { target: { kind: "project_path", relativePath: input.allowedPath }, operations: ["add", "rewrite"] } }])}`,
    "evidenceBoundaries: []",
    `explicitNonGoals: ${JSON.stringify([input.nonGoal])}`,
    "",
  ].join("\n");
}

function initialize(name) {
  const source = join(examplesRoot, name);
  const project = join(runtimeRoot, name);
  mkdirSync(project, { recursive: true });
  const input = JSON.parse(readFileSync(join(source, "input", "brief.json"), "utf8"));
  const expected = JSON.parse(readFileSync(join(source, "expected-behavior.json"), "utf8"));
  const initialized = command(project, ["init", "--title", input.title, "--yes"]);
  writeFileSync(join(project, ".sestina", "research-brief.yaml"), briefYaml(initialized.json.projectId, input), "utf8");
  command(project, ["brief", "edit", "--from", ".sestina/research-brief.yaml", "--yes"]);
  const artifactPath = input.artifactPath;
  const candidatePath = input.candidatePath;
  mkdirSync(join(project, dirname(artifactPath)), { recursive: true });
  mkdirSync(join(project, dirname(candidatePath)), { recursive: true });
  cpSync(join(source, "input", "baseline.md"), join(project, artifactPath));
  cpSync(join(source, "input", "candidate.md"), join(project, candidatePath));
  const artifact = command(project, ["artifact", "add", "--kind", "section", "--path", artifactPath]).json;
  const revision = command(project, ["revision", "add", artifact.artifactId, "--path", candidatePath]).json;
  return { project, input, expected, artifactId: artifact.artifactId, baselineId: artifact.revisionId, candidateId: revision.revisionId };
}

function startReview(state, allowedCodes) {
  const started = command(state.project, ["episode", "start", "--artifact", state.artifactId, "--baseline", state.baselineId]).json;
  command(state.project, ["episode", "submit", started.episodeId, "--revision", state.candidateId]);
  const review = command(state.project, ["review", "run", started.episodeId, "--deterministic", "--verbose"], allowedCodes);
  return { episodeId: started.episodeId, reviewCode: review.code, review: review.json };
}

function finish(state, reviewed, disposition) {
  command(state.project, ["episode", disposition, reviewed.episodeId, "--reason", `Offline demo ${disposition}`, "--yes"]);
  const snapshot = command(state.project, ["snapshot", "create", reviewed.episodeId, "--build-version", "offline-demo", "--limitation", "Deterministic checks and integrity hashes do not prove semantic research correctness"]).json;
  const markdown = command(state.project, ["report", "markdown", reviewed.review.reviewRunId]).json.report;
  const jsonText = command(state.project, ["report", "json", reviewed.review.reviewRunId]).json.report;
  const jsonReport = JSON.parse(jsonText);
  const capsule = command(state.project, ["capsule", "export", reviewed.episodeId]).json;
  writeFileSync(join(state.project, "actual-report.md"), markdown, "utf8");
  writeFileSync(join(state.project, "actual-report.json"), `${jsonText}\n`, "utf8");
  writeFileSync(join(state.project, "actual-capsule.json"), `${capsule.capsule}\n`, "utf8");
  invariant(snapshot.hashMeaning === "content_integrity_only", "Snapshot overstated its hash meaning");
  invariant(capsule.canMutateAuthority === false, "Capsule projection gained mutation authority");
  invariant(markdown.includes("semantic_pending") || markdown.includes("semantic\\_pending"), "Markdown report omitted semantic_pending");
  invariant(jsonReport.report.userActions.some((item) => item.includes("semantic_pending")), "JSON report omitted semantic_pending");
  return { markdown, jsonReport };
}

function countPresentation(review, presentation) {
  return review.findings.filter((finding) => finding.presentation === presentation).length;
}

function demoFocusSubstitution() {
  const state = initialize("01-focus-substitution");
  const reviewed = startReview(state, [0]);
  const reports = finish(state, reviewed, "accept");
  const result = {
    demo: "01-focus-substitution",
    reviewExitCode: reviewed.reviewCode,
    deterministicScopeFindings: reviewed.review.findings.filter((finding) => finding.kind.startsWith("scope_")).length,
    semanticStatus: reviewed.review.semanticStatus,
    fulfillmentCoverage: reports.jsonReport.report.outcome.dimensions.fulfillment.coverage[0]?.status,
  };
  invariant(result.reviewExitCode === state.expected.reviewExitCode, "Focus-substitution exit code drifted");
  invariant(result.deterministicScopeFindings === 0, "Focus-substitution demo invented a scope finding");
  invariant(result.semanticStatus === "semantic_pending", "Focus-substitution was falsely treated as semantically checked");
  invariant(result.fulfillmentCoverage === "unproven", "Focus-substitution fulfillment was falsely proven");
  return result;
}

function demoResolvedAudit() {
  const state = initialize("02-resolved-audit-repetition");
  const first = startReview(state, [5]);
  const issues = command(state.project, ["issue", "list"]).json.issues;
  invariant(issues.length > 0, "Initial review did not create an Issue");
  for (const issue of issues) command(state.project, ["issue", "resolve", issue.id, "--reason", "Correction was reviewed", "--evidence-id", "offline-demo-resolution", "--yes"]);
  const repeated = startReview(state, [0]);
  const reports = finish(state, repeated, "accept");
  const result = {
    demo: "02-resolved-audit-repetition",
    reviewExitCode: repeated.reviewCode,
    foregroundFindings: countPresentation(repeated.review, "foreground"),
    suppressedFindings: countPresentation(repeated.review, "suppressed"),
    reportShowsSuppressedAudit: reports.markdown.includes("1 suppressed Finding"),
    semanticStatus: repeated.review.semanticStatus,
  };
  invariant(result.reviewExitCode === state.expected.reviewExitCode, "Resolved-audit repeat remained blocking");
  invariant(result.foregroundFindings === 0 && result.suppressedFindings > 0, "Resolved repeat was not removed from foreground");
  invariant(result.reportShowsSuppressedAudit, "Resolved repeat report omitted suppressed audit");
  return result;
}

function demoScopeOverreach() {
  const state = initialize("03-scope-overreach");
  const reviewed = startReview(state, [5]);
  const reports = finish(state, reviewed, "reject");
  const blocking = reviewed.review.findings.find((finding) => finding.kind === "scope_violation" && finding.presentation === "foreground");
  const result = {
    demo: "03-scope-overreach",
    reviewExitCode: reviewed.reviewCode,
    blockingKind: blocking?.kind,
    targetKind: blocking?.target?.kind,
    reportNamesRecovery: reports.markdown.includes("Restore the specific block"),
    semanticStatus: reviewed.review.semanticStatus,
  };
  invariant(result.reviewExitCode === state.expected.reviewExitCode, "Scope overreach did not return the blocking exit code");
  invariant(result.blockingKind === "scope_violation" && result.targetKind === "block", "Scope overreach lacked a concrete block Finding");
  invariant(result.reportNamesRecovery, "Scope overreach report lacked a concrete recovery path");
  return result;
}

function demoValidDeepening() {
  const state = initialize("04-valid-deepening-control");
  const reviewed = startReview(state, [0]);
  const reports = finish(state, reviewed, "accept");
  const outcome = reports.jsonReport.report.outcome;
  const result = {
    demo: "04-valid-deepening-control",
    reviewExitCode: reviewed.reviewCode,
    foregroundFindings: countPresentation(reviewed.review, "foreground"),
    checkerHealth: outcome.checkerHealth.status,
    scopeCoverage: outcome.dimensions.scope.coverage[0]?.status,
    decisionIntegrity: outcome.dimensions.decisionIntegrity.obligationIds.length === 0 ? "not_applicable" : "checked",
    issueIntegrity: outcome.dimensions.issueIntegrity.obligationIds.length === 0 ? "not_applicable" : "checked",
    fulfillmentCoverage: outcome.dimensions.fulfillment.coverage[0]?.status,
    semanticStatus: reviewed.review.semanticStatus,
  };
  invariant(result.reviewExitCode === state.expected.reviewExitCode, "Valid deepening returned a failure code");
  invariant(result.foregroundFindings === 0 && result.checkerHealth === "healthy", "Valid deepening invented a Finding or checker failure");
  invariant(result.scopeCoverage === "checked_satisfied", "Valid deepening did not pass deterministic scope review");
  invariant(result.fulfillmentCoverage === "unproven" && result.semanticStatus === "semantic_pending", "Valid deepening was falsely promoted to semantic proof");
  return result;
}

function assertExamplesAreClean() {
  const forbidden = [];
  function walk(directory) {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry); const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (/\.(?:sqlite|sqlite3|db)(?:-wal|-shm)?$/i.test(entry) || entry.endsWith(".log")) forbidden.push(path);
    }
  }
  walk(examplesRoot);
  invariant(forbidden.length === 0, "Demo left runtime state inside the repository");
}

try {
  invariant(existsSync(cliPath), "Bundled CLI is missing");
  assertExamplesAreClean();
  const results = [demoFocusSubstitution(), demoResolvedAudit(), demoScopeOverreach(), demoValidDeepening()];
  assertExamplesAreClean();
  for (const result of results) process.stdout.write(`${JSON.stringify(result)}\n`);
  process.stdout.write(`${JSON.stringify({ demos: results.length, offline: true, runtimeArtifactsRetained: false })}\n`);
} catch (error) {
  process.stderr.write(`Offline demo failure: ${error instanceof Error ? error.message : "unknown failure"}\n`);
  process.exitCode = 1;
} finally {
  rmSync(runtimeRoot, { recursive: true, force: true });
}
