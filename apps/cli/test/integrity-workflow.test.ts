import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli, type CliIo } from "../src/main.js";

const roots: string[] = [];

function capture(cwd: string): { readonly io: CliIo; readonly stdout: string[]; readonly stderr: string[] } {
  const stdout: string[] = []; const stderr: string[] = [];
  return { stdout, stderr, io: { cwd, isTTY: false, stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value) } };
}

async function command(cwd: string, args: readonly string[]): Promise<{ readonly code: number; readonly json?: Record<string, unknown>; readonly stderr: string }> {
  const output = capture(cwd);
  const code = await runCli([...args, "--json"], output.io);
  const text = output.stdout.join("").trim();
  return { code, ...(text.length > 0 ? { json: JSON.parse(text) as Record<string, unknown> } : {}), stderr: output.stderr.join("") };
}

function briefYaml(projectId: string): string {
  return [
    `projectId: ${JSON.stringify(projectId)}`,
    `projectQuestion: ${JSON.stringify("Can the bounded claim be stated without evidence overreach?")}`,
    "currentStage: revision",
    `currentTask: ${JSON.stringify("Revise only the allowed introduction block")}`,
    "targetArtifacts: []",
    "fixedDecisions: []",
    `allowedChanges: ${JSON.stringify([{ target: { kind: "project_path", relativePath: "allowed" }, operations: ["add", "delete", "rewrite"] }])}`,
    "forbiddenChanges: []",
    `expectedDeltas: ${JSON.stringify([{ statement: "Bound the causal claim", scope: { target: { kind: "project_path", relativePath: "allowed" }, operations: ["rewrite"] } }])}`,
    "evidenceBoundaries: []",
    `explicitNonGoals: ${JSON.stringify(["Collect new evidence"])}`,
    "",
  ].join("\n");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("CLI local research integrity workflow", () => {
  it("runs decisions, deterministic review, issue authority, risk disposition, snapshot, reports, and capsule stale rejection", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "sestina-integrity-")); roots.push(sandbox);
    const project = join(sandbox, "study");
    const initialized = await command(sandbox, ["init", "--project", project, "--title", "Integrity Study", "--yes"]);
    const projectId = String(initialized.json?.projectId);
    await writeFile(join(project, ".sestina", "research-brief.yaml"), briefYaml(projectId), "utf8");
    expect((await command(sandbox, ["brief", "edit", "--project", project, "--from", ".sestina/research-brief.yaml", "--yes"])).code).toBe(0);

    const proposed = await command(sandbox, ["decision", "add", "--project", project, "--statement", "Do not infer causality", "--rationale", "The evidence is observational", "--scope", "project", "--reopen-condition", "New experimental evidence"]);
    expect(proposed).toMatchObject({ code: 0, json: { command: "decision add", status: "proposed", authority: "user_recorded" } });
    const decisionId = String(proposed.json?.decisionId);
    expect((await command(sandbox, ["decision", "accept", decisionId, "--project", project, "--reason", "Adopt the evidence boundary"])).code).toBe(7);
    expect((await command(sandbox, ["decision", "accept", decisionId, "--project", project, "--reason", "Adopt the evidence boundary", "--yes"]))).toMatchObject({ code: 0, json: { status: "accepted" } });
    expect((await command(sandbox, ["decision", "freeze", decisionId, "--project", project, "--reason", "Keep this fixed during revision", "--yes"]))).toMatchObject({ code: 0, json: { status: "frozen" } });
    const superseded = await command(sandbox, ["decision", "supersede", decisionId, "--project", project, "--statement", "Do not infer unmeasured causality", "--rationale", "A narrower rule is sufficient", "--scope", "project", "--reason", "Replace explicitly", "--yes"]);
    expect(superseded).toMatchObject({ code: 0, json: { oldDecisionId: decisionId, oldStatus: "superseded", newStatus: "accepted" } });
    expect((await command(sandbox, ["decision", "list", "--project", project])).json?.decisions).toEqual(expect.arrayContaining([expect.objectContaining({ id: decisionId, status: "superseded" })]));

    await mkdir(join(project, "outside"), { recursive: true });
    await writeFile(join(project, "outside", "claim.md"), "# Claim\n\nThe intervention caused the outcome.\n", "utf8");
    const artifact = await command(sandbox, ["artifact", "add", "--project", project, "--kind", "section", "--path", "outside/claim.md"]);
    const artifactId = String(artifact.json?.artifactId); const baselineId = String(artifact.json?.revisionId);
    await writeFile(join(project, "outside", "claim-r2.md"), "# Claim\n\nThe intervention certainly caused every outcome.\n\n## Implication\n\nThis also proves an unrelated claim.\n", "utf8");
    const revision = await command(sandbox, ["revision", "add", artifactId, "--project", project, "--path", "outside/claim-r2.md"]);
    const candidateId = String(revision.json?.revisionId);
    const started = await command(sandbox, ["episode", "start", "--project", project, "--artifact", artifactId, "--baseline", baselineId]);
    const episodeId = String(started.json?.episodeId);
    expect((await command(sandbox, ["episode", "submit", episodeId, "--project", project, "--revision", candidateId])).code).toBe(0);

    const reviewed = await command(sandbox, ["review", "run", episodeId, "--project", project, "--deterministic"]);
    expect(reviewed).toMatchObject({ code: 5, json: { command: "review run", reviewMode: "deterministic_only", semanticStatus: "semantic_pending", reviewReady: false } });
    expect(reviewed.json?.reviewRunId).toEqual(expect.stringMatching(/^rrun_/));
    expect(reviewed.json?.findings).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "scope_violation", severity: "error" })]));
    const reviewedProjection = reviewed.json?.findingProjection as { readonly metrics: { readonly foregroundFindingCount: unknown; readonly returnToMainTaskActions: unknown } };
    expect(reviewed.json?.allFindings).toBe(false);
    expect(typeof reviewedProjection.metrics.foregroundFindingCount).toBe("number");
    expect(Array.isArray(reviewedProjection.metrics.returnToMainTaskActions)).toBe(true);
    expect((reviewed.json?.findings as readonly unknown[]).length).toBeLessThanOrEqual(3);
    const runId = String(reviewed.json?.reviewRunId);
    const shown = await command(sandbox, ["review", "show", runId, "--project", project, "--all-findings", "--verbose"]);
    expect(shown).toMatchObject({ code: 0, json: { reviewRunId: runId, allFindings: true, findingProjection: reviewed.json?.findingProjection } });
    expect((shown.json?.findings as readonly unknown[]).length).toBe(shown.json?.findingCount);
    const reviewProvenance = shown.json?.provenance as { readonly inputHash: string };
    expect(reviewProvenance.inputHash).toMatch(/^[0-9a-f]{64}$/);

    const issues = await command(sandbox, ["issue", "list", "--project", project]);
    expect(issues.json?.issues).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "scope_violation", status: "open" })]));
    const issueRows = issues.json?.issues as readonly { readonly id: string }[];
    const issueId = String(issueRows[0]?.id);
    expect((await command(sandbox, ["issue", "resolve", issueId, "--project", project, "--reason", "The user accepts a documented correction", "--evidence-id", "manual-correction", "--yes"]))).toMatchObject({ code: 0, json: { status: "resolved" } });
    const repeatedEpisode = await command(sandbox, ["episode", "start", "--project", project, "--artifact", artifactId, "--baseline", baselineId]);
    const repeatedEpisodeId = String(repeatedEpisode.json?.episodeId);
    expect((await command(sandbox, ["episode", "submit", repeatedEpisodeId, "--project", project, "--revision", candidateId])).code).toBe(0);
    const repeatedReview = await command(sandbox, ["review", "run", repeatedEpisodeId, "--project", project, "--deterministic", "--all-findings", "--verbose"]);
    expect(repeatedReview).toMatchObject({ code: 0, json: { reviewReady: false } });
    const repeatedFindings = repeatedReview.json?.findings as readonly { readonly presentation: string; readonly issueIds: readonly string[] }[];
    expect(repeatedFindings.some((finding) => finding.presentation === "suppressed" && finding.issueIds.includes(issueId))).toBe(true);
    expect((await command(sandbox, ["issue", "reopen", issueId, "--project", project, "--reason", "User requests another review", "--yes"]))).toMatchObject({ code: 0, json: { status: "reopened", reopenAuthority: "user_requested" } });
    const waived = await command(sandbox, ["issue", "waive", issueId, "--project", project, "--scope", `issue:${issueId}`, "--reason", "Accept this bounded risk", "--invalidation", "New evidence arrives", "--yes"]);
    expect(waived.code, waived.stderr).toBe(0);
    expect(waived.json).toMatchObject({ status: "waived", scope: `issue:${issueId}` });
    const disputedIssueId = String(issueRows[1]?.id);
    expect(disputedIssueId).toMatch(/^riss_/);
    expect((await command(sandbox, ["issue", "dispute", disputedIssueId, "--project", project, "--reason", "The interpretation remains contested", "--yes"]))).toMatchObject({ code: 0, json: { status: "disputed" } });

    const episodeWaiver = await command(sandbox, ["episode", "waive", episodeId, "--project", project, "--dimension", "evidence", "--scope", "project", "--reason", "Proceed without semantic proof", "--invalidation", "The evidence boundary changes", "--yes"]);
    expect(episodeWaiver).toMatchObject({ code: 0, json: { userDisposition: "waived", dimension: "evidence", verified: false } });

    const accepted = await command(sandbox, ["episode", "accept", episodeId, "--project", project, "--reason", "Proceed with documented risk", "--yes"]);
    expect(accepted).toMatchObject({ code: 0, json: { status: "accepted", verified: false, semanticStatus: "unproven" } });
    expect(accepted.json?.integrity).toMatchObject({ unresolved: [], checkerFailed: [] });

    const snapshot = await command(sandbox, ["snapshot", "create", episodeId, "--project", project, "--build-version", "cli-e2e", "--limitation", "Deterministic integrity checks do not prove research correctness"]);
    expect(snapshot).toMatchObject({ code: 0, json: { hashMeaning: "content_integrity_only" } });
    const snapshotId = String(snapshot.json?.snapshotId);
    expect((await command(sandbox, ["snapshot", "verify", snapshotId, "--project", project]))).toMatchObject({ code: 0, json: { integrityHashValid: true, provesResearchCorrectness: false } });

    const markdown = await command(sandbox, ["report", "markdown", runId, "--project", project]);
    expect(markdown.json?.report).toContain("# Review of outside/claim\\.md");
    const allMarkdown = await command(sandbox, ["report", "markdown", runId, "--project", project, "--all-findings"]);
    expect(allMarkdown.json?.report).toContain("raw findings shown; the authoritative foreground projection remains");
    const reportJson = await command(sandbox, ["report", "json", runId, "--project", project]);
    const parsedReport = JSON.parse(String(reportJson.json?.report)) as { report: { run: { id: string }; findingProjection: { foreground: readonly { finding: { id: string } }[]; suppressed: readonly { findingId: string }[] } } };
    expect(parsedReport).toMatchObject({ schemaVersion: "1.0.0", report: { run: { id: runId } } });

    const capsule = await command(sandbox, ["capsule", "export", episodeId, "--project", project]);
    expect(capsule).toMatchObject({ code: 0, json: { authority: "read_only_projection", canMutateAuthority: false } });
    const capsuleValue = JSON.parse(String(capsule.json?.capsule)) as { readonly capsuleHash: string; readonly reviewInputHash: string; readonly snapshot: { readonly hash: string }; readonly brief: { readonly id: string }; readonly candidate: { readonly revisionId: string }; readonly findings: { readonly foreground: readonly { readonly id: string }[]; readonly suppressed: readonly { readonly id: string }[] } };
    expect(capsuleValue.findings.foreground.map((item) => item.id)).toEqual(parsedReport.report.findingProjection.foreground.map((item) => item.finding.id));
    expect(capsuleValue.findings.suppressed.map((item) => item.id)).toEqual(parsedReport.report.findingProjection.suppressed.map((item) => item.findingId));
    const validResponsePath = join(project, "candidate-response.json");
    await writeFile(validResponsePath, JSON.stringify({ schemaVersion: "1.0.0", authority: "model_proposed_candidate_only", projectId, capsuleHash: capsuleValue.capsuleHash, snapshotHash: capsuleValue.snapshot.hash, reviewInputHash: capsuleValue.reviewInputHash, briefVersionId: capsuleValue.brief.id, artifactRevisionId: capsuleValue.candidate.revisionId, response: { summary: "Proposal only", findings: ["A candidate observation"] } }), "utf8");
    expect((await command(sandbox, ["capsule", "import-response", "candidate-response.json", "--project", project]))).toMatchObject({ code: 0, json: { status: "candidate", authority: "model_proposed", canMutateAuthority: false } });
    const responsePath = join(project, "stale-response.json");
    await writeFile(responsePath, JSON.stringify({ schemaVersion: "1.0.0", authority: "model_proposed_candidate_only", projectId, capsuleHash: capsuleValue.capsuleHash, snapshotHash: "0".repeat(64), reviewInputHash: capsuleValue.reviewInputHash, briefVersionId: capsuleValue.brief.id, artifactRevisionId: capsuleValue.candidate.revisionId, response: { summary: "Proposal only", findings: [] } }), "utf8");
    expect((await command(sandbox, ["capsule", "import-response", "stale-response.json", "--project", project])).code).toBe(4);

    expect(await readFile(join(project, ".sestina", "research-brief.yaml"), "utf8").then((value) => value.includes("Revise only"))).toBe(true);
  });
});
