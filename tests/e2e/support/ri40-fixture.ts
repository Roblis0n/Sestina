import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { runCli, type CliIo } from "../../../apps/cli/src/main.js";
import type { CliDependencies } from "../../../apps/cli/src/connections/connection-plan.js";

const execFileAsync = promisify(execFile);

export interface CliResult {
  readonly code: number;
  readonly json?: Record<string, unknown>;
  readonly stdout: string;
  readonly stderr: string;
}

export interface Ri40Workflow {
  readonly projectRoot: string;
  readonly projectId: string;
  readonly briefId: string;
  readonly briefVersionId: string;
  readonly decisionId: string;
  readonly artifactId: string;
  readonly baselineId: string;
}

function capture(cwd: string): { readonly io: CliIo; readonly stdout: string[]; readonly stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, io: { cwd, isTTY: false, stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value) } };
}

export async function runJsonCli(cwd: string, args: readonly string[], dependencies: CliDependencies = {}): Promise<CliResult> {
  const output = capture(cwd);
  const code = await runCli([...args, "--json"], output.io, dependencies);
  const stdout = output.stdout.join("");
  const stderr = output.stderr.join("");
  const serialized = stdout.trim().length > 0 ? stdout.trim() : stderr.trim();
  let json: Record<string, unknown> | undefined;
  if (serialized.length > 0) {
    try { json = JSON.parse(serialized) as Record<string, unknown>; }
    catch { json = undefined; }
  }
  return { code, ...(json === undefined ? {} : { json }), stdout, stderr };
}

function briefYaml(projectId: string): string {
  return [
    `projectId: ${JSON.stringify(projectId)}`,
    `projectQuestion: ${JSON.stringify("How can an observational claim remain bounded by the available synthetic evidence?")}`,
    "currentStage: revision",
    `currentTask: ${JSON.stringify("Replace the causal sentence with one bounded association claim.")}`,
    "targetArtifacts: []",
    `fixedDecisions: ${JSON.stringify([{ statement: "Do not infer causality from the observational design.", scope: { target: { kind: "project_path", relativePath: "outside/claim.md" }, operations: ["rewrite"] } }])}`,
    `allowedChanges: ${JSON.stringify([{ target: { kind: "project_path", relativePath: "allowed" }, operations: ["add", "delete", "rewrite"] }])}`,
    "forbiddenChanges: []",
    `expectedDeltas: ${JSON.stringify([{ statement: "Replace causation with association.", scope: { target: { kind: "project_path", relativePath: "outside/claim.md" }, operations: ["rewrite"] } }])}`,
    `evidenceBoundaries: ${JSON.stringify([{ statement: "Observational evidence does not establish causality.", scope: { target: { kind: "project_path", relativePath: "outside/claim.md" }, operations: ["rewrite"] }, forbiddenInferenceKinds: ["causal"] }])}`,
    `explicitNonGoals: ${JSON.stringify(["Collect new evidence", "Change the research question"])}`,
    "",
  ].join("\n");
}

export async function initializeRi40Workflow(parent: string): Promise<Ri40Workflow> {
  const projectRoot = `${parent}/anonymous-study`;
  await mkdir(projectRoot, { recursive: true });
  await execFileAsync("git", ["init", "--quiet"], { cwd: projectRoot, windowsHide: true });
  const initialized = await runJsonCli(parent, ["init", "--project", projectRoot, "--title", "Anonymous continuity study", "--yes"]);
  if (initialized.code !== 0) throw new Error(`init:${initialized.code}`);
  const projectId = String(initialized.json?.projectId);
  await writeFile(`${projectRoot}/.sestina/research-brief.yaml`, briefYaml(projectId), "utf8");
  const brief = await runJsonCli(parent, ["brief", "edit", "--project", projectRoot, "--from", ".sestina/research-brief.yaml", "--yes"]);
  if (brief.code !== 0) throw new Error(`brief:${brief.code}`);

  const decision = await runJsonCli(parent, ["decision", "add", "--project", projectRoot, "--statement", "Do not infer causality from the observational design.", "--rationale", "Only observational evidence is available.", "--scope", "project", "--reopen-condition", "A randomized design is supplied."]);
  const decisionId = String(decision.json?.decisionId);
  if (decision.code !== 0 || !decisionId.startsWith("rdec_")) throw new Error(`decision:${decision.code}`);
  if ((await runJsonCli(parent, ["decision", "accept", decisionId, "--project", projectRoot, "--reason", "Preserve the evidence boundary.", "--yes"])).code !== 0) throw new Error("decision_accept");
  if ((await runJsonCli(parent, ["decision", "freeze", decisionId, "--project", projectRoot, "--reason", "Keep this decision fixed during the revision.", "--yes"])).code !== 0) throw new Error("decision_freeze");

  await mkdir(`${projectRoot}/outside`, { recursive: true });
  await writeFile(`${projectRoot}/outside/claim.md`, "# Synthetic result\n\nThe intervention caused the observed improvement.\n", "utf8");
  const artifact = await runJsonCli(parent, ["artifact", "add", "--project", projectRoot, "--kind", "section", "--path", "outside/claim.md"]);
  const artifactId = String(artifact.json?.artifactId);
  const baselineId = String(artifact.json?.revisionId);
  if (artifact.code !== 0 || !artifactId.startsWith("rart_") || !baselineId.startsWith("rrev_")) throw new Error(`artifact:${artifact.code}`);
  return {
    projectRoot,
    projectId,
    briefId: String(brief.json?.briefId),
    briefVersionId: String(brief.json?.versionId),
    decisionId,
    artifactId,
    baselineId,
  };
}

export async function readDatabaseBytes(projectRoot: string): Promise<Buffer> {
  return await readFile(`${projectRoot}/.sestina/state.sqlite`);
}
