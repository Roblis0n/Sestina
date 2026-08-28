import { createHash } from "node:crypto";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SestinaCore } from "../packages/core/src/index.ts";
import { RandomIdFactory, SystemClock } from "../packages/core/src/id-factory.ts";
import { MIGRATIONS, openDatabase } from "../packages/storage/src/index.ts";

const USER = Object.freeze({ kind: "user", actorId: "ri53-lifecycle-owner" });
const MODEL = Object.freeze({ kind: "model", actorId: "ri53-lifecycle-fixture" });
const CURRENT_TASK = "Verify Decision, Issue, Episode, Receipt, and Brief continuity without network access.";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function valueOf(result) {
  if (!result.ok) throw new Error(result.error.code + ":" + result.error.message);
  return result.value;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const rootArgument = argument("--root");
const mode = argument("--mode") ?? "upgrade";
invariant(rootArgument !== undefined && ["upgrade", "migration-failure", "future"].includes(mode), "Usage: prepare-ri53-lifecycle-fixture.mjs --root <empty-directory> --mode <upgrade|migration-failure|future>");
const root = await realpath(rootArgument);
invariant((await stat(root)).isDirectory(), "fixture_root_not_directory");
const stateDirectory = join(root, ".sestina");
await mkdir(stateDirectory, { recursive: false });
const databasePath = join(stateDirectory, "state.sqlite");
const targetSchema = mode === "future" ? MIGRATIONS.length : 16;
const database = await openDatabase({ path: databasePath, migrate: { migrations: MIGRATIONS.slice(0, targetSchema) } });
const core = new SestinaCore(database, new SystemClock(), new RandomIdFactory());

const project = valueOf(core.initializeProject({ title: "RI-53 " + mode + " continuity", rootPath: ".", actor: USER }));
const artifact = valueOf(core.createArtifactWithInitialRevision({
  projectId: project.id,
  actor: USER,
  kind: "research_note",
  relativePath: "paper/continuity-note.md",
  content: "# RI-53 continuity\n\nThe release lifecycle must preserve this bounded local record.\n",
  mediaType: "text/markdown",
}));
valueOf(core.activateBrief({
  projectId: project.id,
  actor: USER,
  projectQuestion: "Can a Research Room release preserve canonical local research state through upgrade and reinstall?",
  currentStage: "revision",
  currentTask: CURRENT_TASK,
  targetArtifacts: [artifact.artifact.id],
  fixedDecisions: [],
  allowedChanges: [{ target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["rewrite"] }],
  forbiddenChanges: [{ target: { kind: "project_path", relativePath: ".sestina" }, operations: ["delete"] }],
  expectedDeltas: [{ statement: "Produce exact lifecycle evidence.", scope: { target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["rewrite"] } }],
  evidenceBoundaries: [{ statement: "A local pass does not prove external user value.", scope: { target: { kind: "project_path", relativePath: "paper" }, operations: ["rewrite"] }, forbiddenInferenceKinds: ["causal"] }],
  explicitNonGoals: ["Use a remote Provider", "Publish a release", "Downgrade project state"],
}));
const brief = valueOf(core.getBriefState(project.id));
invariant(brief !== undefined, "fixture_brief_missing");
const decision = valueOf(core.recordDecision({
  projectId: project.id,
  actor: USER,
  statement: "Release recovery must remain explicit and project-bound.",
  scope: { kind: "project" },
  rationale: "The user remains the only research Authority.",
  effectiveBriefVersionId: brief.version.id,
  reopenConditions: ["The recovery authority contract changes."],
  status: "accepted",
}));
const issue = valueOf(core.openIssue({
  projectId: project.id,
  actor: MODEL,
  kind: "evidence_boundary",
  target: { kind: "artifact", artifactId: artifact.artifact.id },
  violatedCriterion: "remote_matrix_evidence_required",
  rationaleConcepts: ["platform", "continuity"],
  summary: "A local lifecycle alone cannot establish the independent three-platform gate.",
  sourceArtifactId: artifact.artifact.id,
  sourceRevisionId: artifact.revision.id,
  sourceRevisionContentHash: artifact.revision.content.contentHash,
  lineageRootRevisionId: artifact.revision.id,
}));
const episode = valueOf(core.startRevisionEpisode({
  projectId: project.id,
  artifactId: artifact.artifact.id,
  briefVersionId: brief.version.id,
  baselineRevisionId: artifact.revision.id,
  actor: USER,
}));
const prepared = valueOf(core.prepareResearchRoomReview({
  projectId: project.id,
  suggestion: "Retain the explicit recovery boundary and record platform-specific evidence.",
  evidenceClass: "synthetic_fixture",
  countsAsExternalEvidence: false,
}));
const analyzed = valueOf(await core.analyzeResearchRoomSuggestion({
  reviewId: prepared.reviewId,
  confirmationNonce: prepared.confirmationNonce,
  manifestHash: prepared.manifestHash,
}));
const receipt = valueOf(core.commitResearchRoomDisposition({
  projectId: project.id,
  reviewId: analyzed.reviewId,
  authorityNonce: analyzed.authorityNonce,
  expectedStateBinding: analyzed.stateBinding,
  disposition: "deferred",
  reason: "Keep the synthetic lifecycle proposal non-authoritative until the platform matrix is green.",
  actor: USER,
}));
const projection = valueOf(core.getActiveBriefProjection(project.id));
invariant(projection !== undefined, "fixture_projection_missing");
await writeFile(join(stateDirectory, "research-brief.yaml"), projection.yaml, "utf8");
core.close();

if (mode === "migration-failure") {
  const sabotage = await openDatabase({ path: databasePath, migrate: false });
  sabotage.exec("CREATE TABLE correction_appeals (appeal_id TEXT PRIMARY KEY) STRICT");
  sabotage.close();
} else if (mode === "future") {
  const future = await openDatabase({ path: databasePath, migrate: false });
  const now = Date.now();
  future.run("INSERT INTO migrations (version, name, status, runtime_version, started_at, finished_at) VALUES (21, '021-ri53-future-fixture', 'completed', 'future-runtime', ?, ?)", now, now);
  future.close();
}

const bindingHash = createHash("sha256").update([project.id, decision.id, issue.id, episode.id, receipt.id].join("\0")).digest("hex");
process.stdout.write(JSON.stringify({
  ok: true,
  mode,
  schemaVersion: mode === "future" ? 21 : 16,
  projectId: project.id,
  decisionId: decision.id,
  issueId: issue.id,
  episodeId: episode.id,
  receiptId: receipt.id,
  currentTask: CURRENT_TASK,
  bindingHash,
}) + "\n");
