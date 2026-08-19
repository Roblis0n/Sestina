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

function briefYaml(projectId: string, task: string): string {
  return [
    "# Editable YAML projection; arrays and objects use the JSON-compatible YAML form.",
    `projectId: ${JSON.stringify(projectId)}`,
    `projectQuestion: ${JSON.stringify("How can the claim be tightened without changing the evidence?")}`,
    "currentStage: revision",
    `currentTask: ${JSON.stringify(task)}`,
    "targetArtifacts: []",
    "fixedDecisions: []",
    `allowedChanges: ${JSON.stringify([{ target: { kind: "project_path", relativePath: "drafts" }, operations: ["add", "delete", "rewrite"] }])}`,
    "forbiddenChanges: []",
    `expectedDeltas: ${JSON.stringify([{ statement: "Tighten the bounded claim", scope: { target: { kind: "project_path", relativePath: "drafts" }, operations: ["rewrite"] } }])}`,
    "evidenceBoundaries: []",
    `explicitNonGoals: ${JSON.stringify(["Collect new data"])}`,
    "",
  ].join("\n");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("CLI research preparation lifecycle", () => {
  it("prepares a Brief, revision chain, diff, and submitted Episode without database editing", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "sestina-prep-")); roots.push(sandbox);
    const project = join(sandbox, "study");
    const initialized = await command(sandbox, ["init", "--project", project, "--title", "Study", "--yes"]);
    expect(initialized.code).toBe(0);
    const projectId = String(initialized.json?.projectId);
    const briefPath = join(project, ".sestina", "research-brief.yaml");
    await writeFile(briefPath, briefYaml(projectId, "Tighten the introduction"), "utf8");

    const edited = await command(sandbox, ["brief", "edit", "--project", project, "--from", ".sestina/research-brief.yaml", "--yes"]);
    expect(edited).toMatchObject({ code: 0, json: { command: "brief edit", status: "active", version: 1 } });
    expect(edited.json?.changedFields).toEqual(expect.arrayContaining(["currentTask", "expectedDeltas"]));
    const shown = await command(sandbox, ["brief", "show", "--project", project]);
    expect(shown).toMatchObject({ code: 0, json: { command: "brief show", status: "active", currentTask: "Tighten the introduction" } });
    const doctor = await command(sandbox, ["doctor", "--project", project]);
    expect(doctor).toMatchObject({ code: 0, json: { brief: { status: "in_sync" } } });

    const baselinePath = join(project, "drafts", "introduction.md");
    await mkdir(join(project, "drafts"), { recursive: true });
    await writeFile(baselinePath, "# Introduction\n\nThe intervention caused improvement.\n", "utf8");
    const artifact = await command(sandbox, ["artifact", "add", "--project", project, "--kind", "section", "--path", "drafts/introduction.md"]);
    expect(artifact).toMatchObject({ code: 0, json: { command: "artifact add" } });
    expect(artifact.json?.artifactId).toEqual(expect.stringMatching(/^rart_/));
    expect(artifact.json?.revisionId).toEqual(expect.stringMatching(/^rrev_/));
    expect(artifact.json?.contentHash).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
    const artifactId = String(artifact.json?.artifactId); const baselineId = String(artifact.json?.revisionId);
    const artifacts = await command(sandbox, ["artifact", "list", "--project", project]);
    expect(artifacts.code).toBe(0);
    expect(artifacts.json?.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ id: artifactId, path: "drafts/introduction.md" })]));

    await writeFile(join(project, "drafts", "introduction-r2.md"), "# Introduction\n\nThe improvement was associated with the intervention.\n", "utf8");
    const revision = await command(sandbox, ["revision", "add", artifactId, "--project", project, "--path", "drafts/introduction-r2.md"]);
    expect(revision).toMatchObject({ code: 0, json: { command: "revision add", parentRevisionId: baselineId } });
    expect(revision.json?.revisionId).toEqual(expect.stringMatching(/^rrev_/));
    expect(revision.json?.contentHash).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
    const candidateId = String(revision.json?.revisionId);
    const diff = await command(sandbox, ["revision", "diff", baselineId, candidateId, "--project", project]);
    expect(diff).toMatchObject({ code: 0, json: { command: "revision diff", baselineRevisionId: baselineId, candidateRevisionId: candidateId } });
    expect(Array.isArray(diff.json?.changes)).toBe(true);

    const episode = await command(sandbox, ["episode", "start", "--project", project, "--artifact", artifactId, "--baseline", baselineId]);
    expect(episode).toMatchObject({ code: 0, json: { command: "episode start", status: "active" } });
    expect(episode.json?.episodeId).toEqual(expect.stringMatching(/^repi_/));
    expect(episode.json?.lockedBriefVersionId).toEqual(expect.stringMatching(/^rbrf_/));
    expect(Array.isArray(episode.json?.decisions)).toBe(true);
    const episodeId = String(episode.json?.episodeId);
    const submitted = await command(sandbox, ["episode", "submit", episodeId, "--project", project, "--revision", candidateId]);
    expect(submitted).toMatchObject({ code: 0, json: { command: "episode submit", status: "candidate_submitted", candidateRevisionId: candidateId } });
    const episodeShown = await command(sandbox, ["episode", "show", episodeId, "--project", project]);
    expect(episodeShown).toMatchObject({ code: 0, json: { status: "candidate_submitted", baselineRevisionId: baselineId, candidateRevisionId: candidateId } });
  });

  it("fails closed for stale Brief edits, unsafe or missing paths, foreign baselines, and unconfirmed scope acceptance", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "sestina-prep-fail-")); roots.push(sandbox);
    const projectA = join(sandbox, "a"); const projectB = join(sandbox, "b");
    const initA = await command(sandbox, ["init", "--project", projectA, "--title", "A", "--yes"]); const projectAId = String(initA.json?.projectId);
    const initB = await command(sandbox, ["init", "--project", projectB, "--title", "B", "--yes"]); const projectBId = String(initB.json?.projectId);
    await writeFile(join(projectA, ".sestina", "research-brief.yaml"), briefYaml(projectAId, "Task A"), "utf8");
    await writeFile(join(projectB, ".sestina", "research-brief.yaml"), briefYaml(projectBId, "Task B"), "utf8");
    expect((await command(sandbox, ["brief", "edit", "--project", projectA, "--from", ".sestina/research-brief.yaml", "--yes"])).code).toBe(0);
    expect((await command(sandbox, ["brief", "edit", "--project", projectB, "--from", ".sestina/research-brief.yaml", "--yes"])).code).toBe(0);
    await writeFile(join(projectA, ".sestina", "research-brief.yaml"), briefYaml(projectAId, "Changed task"), "utf8");
    expect((await command(sandbox, ["brief", "edit", "--project", projectA, "--from", ".sestina/research-brief.yaml", "--expected-version", "999", "--yes"])).code).toBe(4);
    expect((await command(sandbox, ["artifact", "add", "--project", projectA, "--kind", "section", "--path", "../escape.md"])).code).toBe(2);
    expect((await command(sandbox, ["artifact", "add", "--project", projectA, "--kind", "section", "--path", "drafts/missing.md"])).code).toBe(2);

    await mkdir(join(projectA, "drafts"), { recursive: true }); await mkdir(join(projectB, "drafts"), { recursive: true });
    await writeFile(join(projectA, "drafts", "a.md"), "# A\n", "utf8"); await writeFile(join(projectB, "drafts", "b.md"), "# B\n", "utf8");
    const artifactA = await command(sandbox, ["artifact", "add", "--project", projectA, "--kind", "section", "--path", "drafts/a.md"]);
    const artifactB = await command(sandbox, ["artifact", "add", "--project", projectB, "--kind", "section", "--path", "drafts/b.md"]);
    const foreign = await command(sandbox, ["episode", "start", "--project", projectB, "--artifact", String(artifactB.json?.artifactId), "--baseline", String(artifactA.json?.revisionId)]);
    expect(foreign.code).toBe(4);

    const changePath = join(projectA, "scope-change.yaml");
    await writeFile(changePath, `reason: ${JSON.stringify("Allow a bounded discussion edit")}\nallowedChanges: ${JSON.stringify([{ target: { kind: "project_path", relativePath: "discussion" }, operations: ["add", "rewrite"] }])}\n`, "utf8");
    const proposed = await command(sandbox, ["brief", "propose-change", "--project", projectA, "--file", "scope-change.yaml"]);
    expect(proposed).toMatchObject({ code: 0, json: { status: "pending" } });
    expect(proposed.json?.proposalId).toEqual(expect.stringMatching(/^rbrf_/));
    const proposalId = String(proposed.json?.proposalId);
    expect((await command(sandbox, ["brief", "accept-change", proposalId, "--project", projectA])).code).toBe(7);
    expect((await command(sandbox, ["brief", "accept-change", proposalId, "--project", projectA, "--yes"])).code).toBe(0);
    expect(await readFile(join(projectA, ".sestina", "research-brief.yaml"), "utf8")).toContain("discussion");
  });
});
