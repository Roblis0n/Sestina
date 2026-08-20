import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_OUTPUT_LIMIT_BYTES, DEFAULT_QUERY_TIMEOUT_MS, openProjectReader } from "../../../../integrations/mcp/src/index.js";
import type { CliDependencies } from "../../../../apps/cli/src/connections/connection-plan.js";
import type { CodexProcessRunner } from "../../../../apps/cli/src/connections/codex-host-verifier.js";
import { initializeRi40Workflow, readDatabaseBytes, runJsonCli } from "../../support/ri40-fixture.js";

const roots: string[] = [];
const repositoryRoot = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))));

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => { await rm(root, { recursive: true, force: true }); }));
});

describe.sequential("RI-40 deterministic one-host workflow", () => {
  it("keeps host observation, model proposal, user action, continuity, and disconnect authority separate", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "sestina-ri40-local-"));
    roots.push(temporaryRoot);
    const fixture = await initializeRi40Workflow(temporaryRoot);
    const runtime = {
      packageRoot: join(repositoryRoot, "integrations", "mcp"),
      serverEntry: join(repositoryRoot, "integrations", "mcp", "dist", "main.js"),
      nodeExecutable: process.execPath,
    };
    const runtimeLocator: NonNullable<CliDependencies["runtimeLocator"]> = () => Promise.resolve({ ok: true, value: runtime });
    expect((await runJsonCli(temporaryRoot, ["connect", "--project", fixture.projectRoot, "--host", "codex", "--yes"], { runtimeLocator })).code).toBe(0);
    expect(await exists(join(fixture.projectRoot, ".codex", "config.toml"))).toBe(true);
    expect(await exists(join(fixture.projectRoot, ".agents", "skills", "sestina-research-integrity", "SKILL.md"))).toBe(true);

    const staticStatus = await runJsonCli(temporaryRoot, ["connection-status", "--project", fixture.projectRoot, "--host", "codex"], { runtimeLocator });
    expect(staticStatus).toMatchObject({ code: 0, json: { state: "configured", hostVerification: "unverified" } });
    let hostRuns = 0;
    const processRunner: CodexProcessRunner = async (request) => {
      hostRuns += 1;
      expect(request.shell).toBe(false);
      expect(request.args).toContain("--ignore-user-config");
      expect(request.args).toContain("read-only");
      expect(request.args).not.toContain("danger-full-access");
      const outputIndex = request.args.indexOf("--output-last-message");
      const outputPath = request.args[outputIndex + 1];
      if (outputPath === undefined) throw new Error("output path required");
      await writeFile(outputPath, JSON.stringify({ projectId: fixture.projectId, briefId: fixture.briefId, briefVersionId: fixture.briefVersionId, authority: "host_observation", canMutateAuthority: false }), "utf8");
      const stdout = [
        { type: "item.completed", item: { type: "mcp_tool_call", server: "sestina", tool: "health", status: "completed", error: null } },
        { type: "item.completed", item: { type: "mcp_tool_call", server: "sestina", tool: "get_research_context", status: "completed", error: null } },
      ].map((event) => JSON.stringify(event)).join("\n");
      return { kind: "completed", exitCode: 0, stdout, stdoutBytes: Buffer.byteLength(stdout), stderrBytes: 0, outputLimitExceeded: false };
    };
    const verified = await runJsonCli(temporaryRoot, ["connection-status", "--project", fixture.projectRoot, "--host", "codex", "--verify-host", "--yes"], {
      runtimeLocator,
      codexExecutableLocator: () => Promise.resolve({ ok: true, value: process.execPath }),
      codexProcessRunner: processRunner,
    });
    expect(hostRuns).toBe(1);
    expect(verified).toMatchObject({
      code: 0,
      json: {
        state: "configured",
        hostVerification: "verified",
        verification: { method: "codex_exec_jsonl", observedTools: ["health", "get_research_context"], authority: "host_observation", canMutateAuthority: false },
      },
    });

    const firstSessionCandidate = {
      candidateMarkdown: "# Synthetic result\n\nThe observed improvement was associated with the intervention.\n",
      materialDelta: "Replaced a causal claim with a bounded association claim.",
      preservedDecisionIds: [fixture.decisionId],
      reopenResolvedIssue: false,
    };
    expect(firstSessionCandidate.preservedDecisionIds).toEqual([fixture.decisionId]);
    await writeFile(join(fixture.projectRoot, "outside", "candidate.md"), firstSessionCandidate.candidateMarkdown, "utf8");
    const candidate = await runJsonCli(temporaryRoot, ["revision", "add", fixture.artifactId, "--project", fixture.projectRoot, "--path", "outside/candidate.md"]);
    const candidateId = String(candidate.json?.revisionId);
    expect(candidateId).toMatch(/^rrev_/u);
    const started = await runJsonCli(temporaryRoot, ["episode", "start", "--project", fixture.projectRoot, "--artifact", fixture.artifactId, "--baseline", fixture.baselineId]);
    const episodeId = String(started.json?.episodeId);
    expect(episodeId).toMatch(/^repi_/u);
    expect((await runJsonCli(temporaryRoot, ["episode", "submit", episodeId, "--project", fixture.projectRoot, "--revision", candidateId])).code).toBe(0);
    const reviewed = await runJsonCli(temporaryRoot, ["review", "run", episodeId, "--project", fixture.projectRoot, "--deterministic"]);
    expect(reviewed).toMatchObject({ code: 5, json: { semanticStatus: "semantic_pending", reviewMode: "deterministic_only" } });
    expect(reviewed.json?.findings).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "scope_violation" })]));
    expect(JSON.stringify(reviewed.json?.findings)).not.toContain(firstSessionCandidate.materialDelta);
    expect((await runJsonCli(temporaryRoot, ["episode", "show", episodeId, "--project", fixture.projectRoot]))).toMatchObject({ code: 0, json: { status: "user_action_required" } });

    const issueList = await runJsonCli(temporaryRoot, ["issue", "list", "--project", fixture.projectRoot]);
    const issues = issueList.json?.issues as readonly { readonly id: string; readonly status: string }[];
    const issueId = String(issues.find((issue) => issue.status === "open")?.id);
    expect(issueId).toMatch(/^riss_/u);
    expect((await runJsonCli(temporaryRoot, ["issue", "resolve", issueId, "--project", fixture.projectRoot, "--reason", "Explicit synthetic test-user resolution.", "--evidence-id", candidateId, "--yes"]))).toMatchObject({ code: 0, json: { status: "resolved" } });
    expect((await runJsonCli(temporaryRoot, ["episode", "accept", episodeId, "--project", fixture.projectRoot, "--reason", "Explicit synthetic test-user disposition.", "--yes"]))).toMatchObject({ code: 0, json: { status: "accepted", semanticStatus: "unproven" } });

    const readContinuity = async () => {
      const opened = await openProjectReader({ projectRoot: fixture.projectRoot, outputLimitBytes: DEFAULT_OUTPUT_LIMIT_BYTES, queryTimeoutMs: DEFAULT_QUERY_TIMEOUT_MS });
      if (!opened.ok) throw new Error(opened.error.code);
      try {
        const context = await opened.value.readResearchContext();
        if (!context.ok) throw new Error(context.error.code);
        return context.value;
      } finally { opened.value.close(); }
    };
    const firstRead = await readContinuity();
    const secondSessionRead = await readContinuity();
    expect(secondSessionRead).toEqual(firstRead);
    expect(secondSessionRead).toMatchObject({
      projectId: fixture.projectId,
      briefId: fixture.briefId,
      versionId: fixture.briefVersionId,
      continuity: {
        currentEpisode: { id: episodeId, status: "accepted", baselineRevisionId: fixture.baselineId, candidateRevisionId: candidateId },
        activeDecisions: [expect.objectContaining({ id: fixture.decisionId, status: "frozen" })],
      },
    });
    const resolvedIssue = secondSessionRead.continuity.relevantIssues.find((issue) => issue.id === issueId);
    expect(resolvedIssue).toMatchObject({ id: issueId, status: "resolved", resolutionRecorded: true });
    const secondSessionOutput = { issueId, treatAsOpenAudit: resolvedIssue?.status === "open", reopenResolvedIssue: false, authority: "model_proposed", canMutateAuthority: false };
    expect(secondSessionOutput).toEqual({ issueId, treatAsOpenAudit: false, reopenResolvedIssue: false, authority: "model_proposed", canMutateAuthority: false });

    const databaseBeforeDisconnect = await readDatabaseBytes(fixture.projectRoot);
    expect((await runJsonCli(temporaryRoot, ["disconnect", "--project", fixture.projectRoot, "--host", "codex", "--yes"], { runtimeLocator })).code).toBe(0);
    expect((await runJsonCli(temporaryRoot, ["disconnect", "--project", fixture.projectRoot, "--host", "codex", "--yes"], { runtimeLocator })).code).toBe(0);
    expect(await readDatabaseBytes(fixture.projectRoot)).toEqual(databaseBeforeDisconnect);
    expect(await exists(join(fixture.projectRoot, ".agents", "skills", "sestina-research-integrity", "SKILL.md"))).toBe(false);
    const config = await readFile(join(fixture.projectRoot, ".codex", "config.toml"), "utf8").catch(() => "");
    expect(config).not.toContain("sestina managed codex mcp");
    expect((await runJsonCli(temporaryRoot, ["brief", "show", "--project", fixture.projectRoot])).code).toBe(0);
    expect((await runJsonCli(temporaryRoot, ["episode", "show", episodeId, "--project", fixture.projectRoot]))).toMatchObject({ code: 0, json: { status: "accepted" } });
    expect((await runJsonCli(temporaryRoot, ["review", "show", String(reviewed.json?.reviewRunId), "--project", fixture.projectRoot])).code).toBe(0);
  }, 60_000);
});
