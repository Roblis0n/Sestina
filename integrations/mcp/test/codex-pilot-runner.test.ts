import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseClosedCodexPilotOutput,
  runClosedCodexPilotAttempt,
  type CodexProcessRequest,
  type CodexProcessRunner,
} from "../src/codex-host.js";

const roots: string[] = [];
const contextUtf8 = JSON.stringify({
  schemaVersion: "1.0.0",
  contentBoundary: { kind: "untrusted_research_data", authority: "none", mayDirectTools: false, grantsPermissions: false, representsUserAcceptance: false, representsAdjudication: false, representsTaskCompletion: false },
  manifestBinding: { pilotId: "rpil_00000000000000000000000000", attemptId: "rpat_00000000000000000000000000", manifestId: "rman_00000000000000000000000000", projectId: "rprj_00000000000000000000000000", host: "codex", purpose: "candidate_generation" },
  projectStateHash: "f".repeat(64), brief: {}, episode: {}, currentTask: "Synthetic", decisions: [], issues: [], evidence: [], workingMemory: [],
});
const binding = {
  pilotId: "rpil_00000000000000000000000000",
  attemptId: "rpat_00000000000000000000000000",
  manifestId: "rman_00000000000000000000000000",
  manifestHash: createHash("sha256").update(contextUtf8, "utf8").digest("hex"),
  projectId: "rprj_00000000000000000000000000",
  briefId: "rbrf_00000000000000000000000000",
  briefVersion: 1,
  episodeId: "repi_00000000000000000000000000",
  decisionIds: ["rdec_00000000000000000000000000"],
  issueIds: ["riss_00000000000000000000000000"],
  evidenceIds: ["revd_00000000000000000000000000"],
} as const;

const candidate = {
  candidateMarkdown: "A bounded candidate.",
  materialDelta: "Adds one explicit uncertainty.",
  preservedDecisionIds: [...binding.decisionIds],
  affectedIssueIds: [...binding.issueIds],
  evidenceUsed: [...binding.evidenceIds],
  unknowns: ["External validity remains unproven."],
  reopenResolvedIssue: false,
  authority: "model_proposed",
  canMutateAuthority: false,
} as const;

function completed(tool: string): string {
  return JSON.stringify({ type: "item.completed", item: { type: "mcp_tool_call", server: "sestina", tool, status: "completed", error: null } });
}

function mcpArgs(args: readonly string[]): readonly string[] {
  const encoded = args.find((arg) => arg.startsWith("mcp_servers.sestina.args="));
  if (encoded === undefined) throw new Error("missing MCP args");
  return JSON.parse(encoded.slice("mcp_servers.sestina.args=".length)) as readonly string[];
}

function fixtureRunner(output: unknown, auditBinding = binding): { runner: CodexProcessRunner; requests: CodexProcessRequest[]; schemas: unknown[] } {
  const requests: CodexProcessRequest[] = [];
  const schemas: unknown[] = [];
  const runner: CodexProcessRunner = async (request) => {
    requests.push(request);
    const schemaPath = request.args[request.args.indexOf("--output-schema") + 1];
    if (schemaPath === undefined) throw new Error("missing schema path");
    schemas.push(JSON.parse(await readFile(schemaPath, "utf8")) as unknown);
    const outputPath = request.args[request.args.indexOf("--output-last-message") + 1];
    if (outputPath === undefined) throw new Error("missing output path");
    await writeFile(outputPath, JSON.stringify(output), "utf8");
    const invocationArgs = mcpArgs(request.args);
    const auditPath = invocationArgs[invocationArgs.indexOf("--audit-file") + 1];
    if (auditPath === undefined) throw new Error("missing audit path");
    const audit = ["health", "get_research_context"].map((tool) => JSON.stringify({
      tool,
      projectId: auditBinding.projectId,
      manifestHash: auditBinding.manifestHash,
      payloadHash: auditBinding.manifestHash,
    })).join("\n");
    await writeFile(auditPath, `${audit}\n`, "utf8");
    return { kind: "completed", exitCode: 0, stdout: `${completed("health")}\n${completed("get_research_context")}\n`, stdoutBytes: 300, stderrBytes: 0, outputLimitExceeded: false };
  };
  return { runner, requests, schemas };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => { await rm(root, { recursive: true, force: true }); }));
});

describe("RI-52 closed Codex Host runner", () => {
  it("parses exact proposal-only output and rejects authority, key, ID, and size violations", () => {
    expect(parseClosedCodexPilotOutput("candidate_generation", JSON.stringify(candidate), binding)).toEqual({ ok: true, value: candidate });
    expect(parseClosedCodexPilotOutput("candidate_generation", JSON.stringify({ ...candidate, canMutateAuthority: true }), binding)).toMatchObject({ ok: false, error: { code: "candidate_schema_mismatch" } });
    expect(parseClosedCodexPilotOutput("candidate_generation", JSON.stringify({ ...candidate, extra: true }), binding)).toMatchObject({ ok: false });
    expect(parseClosedCodexPilotOutput("candidate_generation", JSON.stringify({ ...candidate, preservedDecisionIds: ["rdec_11111111111111111111111111"] }), binding)).toMatchObject({ ok: false });
    expect(parseClosedCodexPilotOutput("candidate_generation", JSON.stringify({ ...candidate, candidateMarkdown: "x".repeat(70_000) }), binding)).toMatchObject({ ok: false, error: { code: "output_too_large" } });
  });

  it("uses a fresh ephemeral read-only argv invocation, verifies JSONL plus audit binding, and removes controlled temporary files", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "sestina-ri52-runner-")); roots.push(projectRoot);
    const fixture = fixtureRunner(candidate);
    const result = await runClosedCodexPilotAttempt({
      kind: "candidate_generation",
      projectRoot,
      binding,
      contextUtf8,
      mcpLaunch: { command: process.execPath, args: [join(projectRoot, "mcp.js")], cwd: projectRoot },
      executableLocator: () => Promise.resolve({ ok: true, value: { executable: "C:\\Program Files\\Codex\\codex.exe", prefixArgs: [] } }),
      processRunner: fixture.runner,
      timeoutMs: 5_000,
      outputLimitBytes: 65_536,
    });
    expect(result).toEqual({ ok: true, value: { candidate, mcpObservation: { health: "completed", getResearchContext: "completed", payloadHash: binding.manifestHash }, stdoutBytes: 300, stderrBytes: 0, usage: "unavailable" } });
    const request = fixture.requests[0];
    expect(request).toBeDefined(); if (request === undefined) return;
    expect(request.shell).toBe(false);
    expect(request.args).toEqual(expect.arrayContaining(["exec", "--ephemeral", "--json", "--sandbox", "read-only", "--ignore-user-config", "--skip-git-repo-check", "--output-schema", "--output-last-message", "-C"]));
    expect(JSON.stringify(fixture.schemas[0])).not.toContain('"uniqueItems"');
    expect(request.args).not.toContain("danger-full-access");
    expect(request.args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    const invocationArgs = mcpArgs(request.args);
    expect(invocationArgs).toEqual(expect.arrayContaining(["--frozen-context-file", "--expected-project-id", binding.projectId, "--expected-manifest-hash", binding.manifestHash, "--audit-file"]));
    const temporaryPaths = [
      request.args[request.args.indexOf("--output-schema") + 1],
      request.args[request.args.indexOf("--output-last-message") + 1],
      invocationArgs[invocationArgs.indexOf("--frozen-context-file") + 1],
      invocationArgs[invocationArgs.indexOf("--audit-file") + 1],
    ];
    for (const path of temporaryPaths) {
      expect(path).toBeDefined();
      if (path !== undefined) await expect(readFile(path, "utf8")).rejects.toThrow();
    }
  });

  it("keeps a zero-Issue continuity schema valid while the strict decoder still checks exact canonical state", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "sestina-ri52-continuity-schema-")); roots.push(projectRoot);
    const continuityBinding = {
      ...binding,
      episodeStatus: "active",
      canonicalStateHash: "a".repeat(64),
      decisionStates: [{ id: binding.decisionIds[0], status: "accepted" }],
      issueStates: [],
    } as const;
    const continuity = {
      authority: "host_observation",
      canMutateAuthority: false,
      projectId: binding.projectId,
      briefId: binding.briefId,
      briefVersion: binding.briefVersion,
      episodeId: binding.episodeId,
      episodeStatus: "active",
      decisionStates: continuityBinding.decisionStates,
      issueStates: [],
      canonicalStateHash: continuityBinding.canonicalStateHash,
    } as const;
    const fixture = fixtureRunner(continuity, continuityBinding);
    const result = await runClosedCodexPilotAttempt({
      kind: "continuity_check",
      projectRoot,
      binding: continuityBinding,
      contextUtf8,
      mcpLaunch: { command: process.execPath, args: [join(projectRoot, "mcp.js")], cwd: projectRoot },
      executableLocator: () => Promise.resolve({ ok: true, value: { executable: "C:\\Program Files\\Codex\\codex.exe", prefixArgs: [] } }),
      processRunner: fixture.runner,
      timeoutMs: 5_000,
      outputLimitBytes: 65_536,
    });
    expect(result).toMatchObject({ ok: true, value: { continuity } });
    expect(JSON.stringify(fixture.schemas[0])).not.toContain('"enum":[]');
  });

  it("does not trust model output or JSONL claims without the exact invocation audit binding", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "sestina-ri52-audit-mismatch-")); roots.push(projectRoot);
    const fixture = fixtureRunner(candidate, { ...binding, manifestHash: "b".repeat(64) });
    await expect(runClosedCodexPilotAttempt({
      kind: "candidate_generation", projectRoot, binding, contextUtf8,
      mcpLaunch: { command: process.execPath, args: [join(projectRoot, "mcp.js")], cwd: projectRoot },
      executableLocator: () => Promise.resolve({ ok: true, value: { executable: "C:\\Codex\\codex.exe", prefixArgs: [] } }),
      processRunner: fixture.runner, timeoutMs: 5_000, outputLimitBytes: 65_536,
    })).resolves.toMatchObject({ ok: false, error: { code: "context_binding_mismatch" } });
  });
});
import { createHash } from "node:crypto";
