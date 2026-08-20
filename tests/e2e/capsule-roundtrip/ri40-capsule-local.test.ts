import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeRi40Workflow, readDatabaseBytes, runJsonCli } from "../support/ri40-fixture.js";

const roots: string[] = [];

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => { await rm(root, { recursive: true, force: true }); }));
});

describe.sequential("RI-40 local Capsule round-trip", () => {
  it("imports only a current bounded candidate and rejects malformed, privileged, oversized, and stale responses without mutation", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "sestina-ri40-capsule-"));
    roots.push(temporaryRoot);
    const fixture = await initializeRi40Workflow(temporaryRoot);
    expect(await exists(join(fixture.projectRoot, ".codex"))).toBe(false);

    const syntheticCandidate = "# Synthetic result\n\nThe observed improvement was associated with the intervention.\n";
    await writeFile(join(fixture.projectRoot, "outside", "candidate.md"), syntheticCandidate, "utf8");
    const candidate = await runJsonCli(temporaryRoot, ["revision", "add", fixture.artifactId, "--project", fixture.projectRoot, "--path", "outside/candidate.md"]);
    const candidateId = String(candidate.json?.revisionId);
    const started = await runJsonCli(temporaryRoot, ["episode", "start", "--project", fixture.projectRoot, "--artifact", fixture.artifactId, "--baseline", fixture.baselineId]);
    const episodeId = String(started.json?.episodeId);
    expect((await runJsonCli(temporaryRoot, ["episode", "submit", episodeId, "--project", fixture.projectRoot, "--revision", candidateId])).code).toBe(0);
    const reviewed = await runJsonCli(temporaryRoot, ["review", "run", episodeId, "--project", fixture.projectRoot, "--deterministic"]);
    expect(reviewed).toMatchObject({ code: 5, json: { semanticStatus: "semantic_pending" } });

    const summaryExport = await runJsonCli(temporaryRoot, ["capsule", "export", episodeId, "--project", fixture.projectRoot]);
    expect(summaryExport).toMatchObject({ code: 0, json: { authority: "read_only_projection", canMutateAuthority: false } });
    const summaryJson = String(summaryExport.json?.capsule);
    expect(summaryJson).not.toContain("The intervention caused the observed improvement");
    expect(summaryJson).not.toContain("The observed improvement was associated with the intervention");
    const summaryCapsule = JSON.parse(summaryJson) as {
      readonly capsuleHash: string;
      readonly reviewInputHash: string;
      readonly snapshot: { readonly hash: string };
      readonly brief: { readonly id: string };
      readonly candidate: { readonly revisionId: string; readonly projection: string; readonly content?: string };
      readonly baseline: { readonly projection: string; readonly content?: string };
      readonly responseSchema: Readonly<Record<string, unknown>>;
    };
    expect(summaryCapsule).toMatchObject({ baseline: { projection: "summary_only" }, candidate: { projection: "summary_only" }, responseSchema: { additionalProperties: false } });

    const fullExport = await runJsonCli(temporaryRoot, ["capsule", "export", episodeId, "--project", fixture.projectRoot, "--include-full-text"]);
    expect(fullExport.code).toBe(0);
    const fullCapsule = JSON.parse(String(fullExport.json?.capsule)) as typeof summaryCapsule;
    expect(fullCapsule).toMatchObject({ baseline: { projection: "permitted_full_text" }, candidate: { projection: "permitted_full_text" } });
    expect(fullCapsule.candidate.content).toContain("associated with the intervention");

    const response = {
      schemaVersion: "1.0.0",
      authority: "model_proposed_candidate_only",
      projectId: fixture.projectId,
      capsuleHash: summaryCapsule.capsuleHash,
      snapshotHash: summaryCapsule.snapshot.hash,
      reviewInputHash: summaryCapsule.reviewInputHash,
      briefVersionId: summaryCapsule.brief.id,
      artifactRevisionId: summaryCapsule.candidate.revisionId,
      response: { summary: "The candidate stays within the observational boundary.", findings: ["The proposal remains subject to explicit user review."] },
    };
    const responsePath = join(fixture.projectRoot, "capsule-response.json");
    await writeFile(responsePath, JSON.stringify(response), "utf8");
    const beforeCurrentImport = await readDatabaseBytes(fixture.projectRoot);
    expect((await runJsonCli(temporaryRoot, ["capsule", "import-response", "capsule-response.json", "--project", fixture.projectRoot]))).toMatchObject({
      code: 0,
      json: { status: "candidate", authority: "model_proposed", canMutateAuthority: false },
    });
    expect(await readDatabaseBytes(fixture.projectRoot)).toEqual(beforeCurrentImport);
    expect((await runJsonCli(temporaryRoot, ["episode", "show", episodeId, "--project", fixture.projectRoot]))).toMatchObject({ code: 0, json: { status: "user_action_required" } });

    const invalidCases: readonly [string, string][] = [
      ["malformed.json", "{not-json"],
      ["extra.json", JSON.stringify({ ...response, accepted: true })],
      ["privileged.json", JSON.stringify({ ...response, authority: "user_confirmed" })],
      ["oversized.json", JSON.stringify({ ...response, response: { summary: "x".repeat(70_000), findings: [] } })],
    ];
    for (const [name, content] of invalidCases) {
      await writeFile(join(fixture.projectRoot, name), content, "utf8");
      const before = await readDatabaseBytes(fixture.projectRoot);
      expect((await runJsonCli(temporaryRoot, ["capsule", "import-response", name, "--project", fixture.projectRoot])).code).not.toBe(0);
      expect(await readDatabaseBytes(fixture.projectRoot)).toEqual(before);
    }

    const issuesResult = await runJsonCli(temporaryRoot, ["issue", "list", "--project", fixture.projectRoot]);
    const issues = issuesResult.json?.issues as readonly { readonly id: string; readonly status: string }[];
    const issueId = String(issues.find((issue) => issue.status === "open")?.id);
    expect((await runJsonCli(temporaryRoot, ["issue", "resolve", issueId, "--project", fixture.projectRoot, "--reason", "Explicit synthetic test-user resolution.", "--evidence-id", candidateId, "--yes"]))).toMatchObject({ code: 0, json: { status: "resolved" } });
    const beforeStaleImport = await readDatabaseBytes(fixture.projectRoot);
    expect((await runJsonCli(temporaryRoot, ["capsule", "import-response", "capsule-response.json", "--project", fixture.projectRoot]))).toMatchObject({ code: 4, json: { error: { code: "stale_state" } } });
    expect(await readDatabaseBytes(fixture.projectRoot)).toEqual(beforeStaleImport);
    expect((await runJsonCli(temporaryRoot, ["issue", "show", issueId, "--project", fixture.projectRoot]))).toMatchObject({ code: 0, json: { status: "resolved" } });
    expect((await runJsonCli(temporaryRoot, ["review", "show", String(reviewed.json?.reviewRunId), "--project", fixture.projectRoot]))).toMatchObject({ code: 0, json: { semanticStatus: "semantic_pending" } });
    expect(await readFile(join(fixture.projectRoot, ".sestina", "research-brief.yaml"), "utf8")).toContain("Replace the causal sentence");
  }, 60_000);
});
