import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseCodexVerificationEvidence,
  verifyCodexHost,
  type CodexProcessRequest,
  type CodexProcessRunner,
} from "../src/connections/codex-host-verifier.js";

const roots: string[] = [];
const binding = {
  projectId: "rprj_00000000000000000000000000",
  briefId: "rbrf_00000000000000000000000000",
  briefVersionId: "rbrf_00000000000000000000000001",
};

function completed(tool: string): string {
  return JSON.stringify({
    type: "item.completed",
    item: { type: "mcp_tool_call", server: "sestina", tool, status: "completed", error: null },
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Codex host verification evidence", () => {
  it("does not trust an agent success message without both MCP completed events", () => {
    const claimed = JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Both tools succeeded." } });
    expect(parseCodexVerificationEvidence(claimed, JSON.stringify({ ...binding, authority: "host_observation", canMutateAuthority: false }), binding))
      .toMatchObject({ ok: false, error: { code: "mcp_not_observed" } });
    expect(parseCodexVerificationEvidence(completed("health"), JSON.stringify({ ...binding, authority: "host_observation", canMutateAuthority: false }), binding))
      .toMatchObject({ ok: false, error: { code: "mcp_not_observed" } });
  });

  it("requires successful health and context events plus an exact structured context binding", () => {
    const stdout = `${completed("health")}\n${completed("get_research_context")}\n`;
    const final = JSON.stringify({ ...binding, authority: "host_observation", canMutateAuthority: false });
    expect(parseCodexVerificationEvidence(stdout, final, binding)).toEqual({
      ok: true,
      value: {
        method: "codex_exec_jsonl",
        observedTools: ["health", "get_research_context"],
        authority: "host_observation",
        canMutateAuthority: false,
      },
    });
    expect(parseCodexVerificationEvidence(stdout, JSON.stringify({ ...binding, briefVersionId: "rbrf_00000000000000000000000002", authority: "host_observation", canMutateAuthority: false }), binding))
      .toMatchObject({ ok: false, error: { code: "context_binding_mismatch" } });
  });

  it("classifies MCP failure, malformed JSONL, and non-completed events without exposing model text", () => {
    const failed = JSON.stringify({ type: "item.completed", item: { type: "mcp_tool_call", server: "sestina", tool: "health", status: "failed", error: "secret model detail" } });
    expect(parseCodexVerificationEvidence(failed, "{}", binding)).toEqual({ ok: false, error: { code: "mcp_call_failed" } });
    expect(parseCodexVerificationEvidence("not-json", "{}", binding)).toEqual({ ok: false, error: { code: "host_protocol_mismatch" } });
  });

  it("runs Codex with argv, read-only sandbox, ephemeral JSONL, invocation-only trust, and bounded temporary files", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "sestina-host-verifier-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, ".git"));
    let request: CodexProcessRequest | undefined;
    const runner: CodexProcessRunner = async (value) => {
      request = value;
      const outputIndex = value.args.indexOf("--output-last-message");
      const outputPath = value.args[outputIndex + 1];
      if (outputPath === undefined) throw new Error("output path required");
      await writeFile(outputPath, JSON.stringify({ ...binding, authority: "host_observation", canMutateAuthority: false }), "utf8");
      return { kind: "completed", exitCode: 0, stdout: `${completed("health")}\n${completed("get_research_context")}\n`, stdoutBytes: 400, stderrBytes: 0, outputLimitExceeded: false };
    };
    const verified = await verifyCodexHost({
      projectRoot,
      binding,
      executableLocator: () => Promise.resolve({ ok: true, value: "C:\\Program Files\\Codex\\codex.exe" }),
      processRunner: runner,
    });
    expect(verified).toMatchObject({ ok: true, value: { method: "codex_exec_jsonl", observedTools: ["health", "get_research_context"] } });
    expect(request).toBeDefined();
    if (request === undefined) return;
    expect(request.shell).toBe(false);
    expect(request.cwd).toBe(projectRoot);
    expect(request.args).toEqual(expect.arrayContaining([
      "exec", "--ephemeral", "--json", "--sandbox", "read-only", "--ignore-user-config", "--output-schema", "--output-last-message", "-c",
    ]));
    expect(request.args).not.toContain("danger-full-access");
    expect(request.args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(request.args.some((item) => item.startsWith("projects.") && item.endsWith('.trust_level="trusted"'))).toBe(true);
    expect(request.args.at(-1)).toContain("get_research_context");
    const schemaPath = request.args[request.args.indexOf("--output-schema") + 1];
    expect(schemaPath).toBeDefined();
    if (schemaPath !== undefined) await expect(readFile(schemaPath, "utf8")).rejects.toThrow();
  });

  it("maps unavailable, nonzero, timeout, and oversized processes to stable categories", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "sestina-host-verifier-errors-"));
    roots.push(projectRoot);
    const locateMissing = () => Promise.resolve({ ok: false as const, error: { code: "host_unavailable" as const } });
    await expect(verifyCodexHost({ projectRoot, binding, executableLocator: locateMissing, processRunner: () => Promise.reject(new Error("must not run")) }))
      .resolves.toEqual({ ok: false, error: { code: "host_unavailable" } });
    const cases = [
      [{ kind: "completed" as const, exitCode: 9, stdout: "", stdoutBytes: 0, stderrBytes: 27, outputLimitExceeded: false }, "host_process_failed"],
      [{ kind: "timeout" as const, exitCode: null, stdout: "", stdoutBytes: 0, stderrBytes: 0, outputLimitExceeded: false }, "host_timeout"],
      [{ kind: "completed" as const, exitCode: 0, stdout: "", stdoutBytes: 2_000_000, stderrBytes: 0, outputLimitExceeded: true }, "host_protocol_mismatch"],
    ] as const;
    for (const [result, code] of cases) {
      await expect(verifyCodexHost({
        projectRoot,
        binding,
        executableLocator: () => Promise.resolve({ ok: true, value: "C:\\Codex\\codex.exe" }),
        processRunner: () => Promise.resolve(result),
      })).resolves.toMatchObject({ ok: false, error: { code } });
    }
  });
});
