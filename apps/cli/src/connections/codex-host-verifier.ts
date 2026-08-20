import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, normalize } from "node:path";

export const CODEX_HOST_TIMEOUT_MS = 120_000;
export const CODEX_HOST_STDOUT_MAX_BYTES = 1_048_576;
export const CODEX_HOST_STDERR_MAX_BYTES = 65_536;
export const CODEX_HOST_JSONL_MAX_LINES = 2_048;
export const CODEX_HOST_FINAL_MAX_BYTES = 65_536;

export interface CodexContextBinding {
  readonly projectId: string;
  readonly briefId: string;
  readonly briefVersionId: string;
}

export interface CodexProcessRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly shell: false;
  readonly stdin?: string;
  readonly timeoutMs: number;
  readonly stdoutMaxBytes: number;
  readonly stderrMaxBytes: number;
}

export type CodexProcessResult =
  | { readonly kind: "completed"; readonly exitCode: number | null; readonly stdout: string; readonly stdoutBytes: number; readonly stderrBytes: number; readonly outputLimitExceeded: boolean }
  | { readonly kind: "timeout"; readonly exitCode: null; readonly stdout: string; readonly stdoutBytes: number; readonly stderrBytes: number; readonly outputLimitExceeded: boolean }
  | { readonly kind: "unavailable"; readonly exitCode: null; readonly stdout: ""; readonly stdoutBytes: 0; readonly stderrBytes: 0; readonly outputLimitExceeded: false };

export type CodexProcessRunner = (request: CodexProcessRequest) => Promise<CodexProcessResult>;
export interface CodexLaunchTarget {
  readonly executable: string;
  readonly prefixArgs: readonly string[];
}

export interface CodexMcpLaunchConfig {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

export type CodexLaunchTargetLocator = (explicitPath?: string) => Promise<
  | { readonly ok: true; readonly value: CodexLaunchTarget }
  | { readonly ok: false; readonly error: { readonly code: "host_unavailable" } }
>;
export type CodexExecutableLocator = CodexLaunchTargetLocator;

export type CodexVerificationErrorCode =
  | "host_unavailable"
  | "host_process_failed"
  | "host_timeout"
  | "host_protocol_mismatch"
  | "mcp_not_observed"
  | "mcp_call_failed"
  | "context_binding_mismatch";

export interface CodexVerificationEvidence {
  readonly method: "codex_exec_jsonl";
  readonly observedTools: readonly ["health", "get_research_context"];
  readonly authority: "host_observation";
  readonly canMutateAuthority: false;
}

export type CodexVerificationResult =
  | { readonly ok: true; readonly value: CodexVerificationEvidence }
  | { readonly ok: false; readonly error: { readonly code: CodexVerificationErrorCode; readonly exitCode?: number | null; readonly stdoutBytes?: number; readonly stderrBytes?: number } };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).toSorted().join("\0") === [...expected].toSorted().join("\0");
}

export function parseCodexVerificationEvidence(
  stdout: string,
  finalOutput: string,
  binding: CodexContextBinding,
): CodexVerificationResult {
  if (Buffer.byteLength(stdout, "utf8") > CODEX_HOST_STDOUT_MAX_BYTES) {
    return { ok: false, error: { code: "host_protocol_mismatch" } };
  }
  const lines = stdout.split(/\r?\n/u).filter((line) => line.length > 0);
  if (lines.length > CODEX_HOST_JSONL_MAX_LINES) return { ok: false, error: { code: "host_protocol_mismatch" } };
  const observed = new Set<string>();
  for (const line of lines) {
    let event: unknown;
    try { event = JSON.parse(line) as unknown; }
    catch { return { ok: false, error: { code: "host_protocol_mismatch" } }; }
    if (!record(event) || typeof event.type !== "string") return { ok: false, error: { code: "host_protocol_mismatch" } };
    if (event.type !== "item.completed" || !record(event.item) || event.item.type !== "mcp_tool_call" || event.item.server !== "sestina") continue;
    if (event.item.tool !== "health" && event.item.tool !== "get_research_context") continue;
    if (event.item.status !== "completed" || event.item.error !== null) return { ok: false, error: { code: "mcp_call_failed" } };
    observed.add(event.item.tool);
  }
  if (!observed.has("health") || !observed.has("get_research_context")) {
    return { ok: false, error: { code: "mcp_not_observed" } };
  }
  if (Buffer.byteLength(finalOutput, "utf8") > CODEX_HOST_FINAL_MAX_BYTES) {
    return { ok: false, error: { code: "host_protocol_mismatch" } };
  }
  let final: unknown;
  try { final = JSON.parse(finalOutput) as unknown; }
  catch { return { ok: false, error: { code: "host_protocol_mismatch" } }; }
  if (!record(final) || !exactKeys(final, ["projectId", "briefId", "briefVersionId", "authority", "canMutateAuthority"])) {
    return { ok: false, error: { code: "host_protocol_mismatch" } };
  }
  if (final.authority !== "host_observation" || final.canMutateAuthority !== false) {
    return { ok: false, error: { code: "host_protocol_mismatch" } };
  }
  if (final.projectId !== binding.projectId || final.briefId !== binding.briefId || final.briefVersionId !== binding.briefVersionId) {
    return { ok: false, error: { code: "context_binding_mismatch" } };
  }
  return {
    ok: true,
    value: {
      method: "codex_exec_jsonl",
      observedTools: ["health", "get_research_context"],
      authority: "host_observation",
      canMutateAuthority: false,
    },
  };
}

async function canonicalFile(path: string): Promise<string | undefined> {
  if (!isAbsolute(path)) return undefined;
  try {
    const canonical = await realpath(path);
    return (await stat(canonical)).isFile() ? canonical : undefined;
  } catch {
    return undefined;
  }
}

function isOfficialNodeLauncher(path: string): boolean {
  const segments = normalize(path).split(/[\\/]+/u).map((segment) => segment.toLowerCase());
  return segments.slice(-4).join("/") === "@openai/codex/bin/codex.js";
}

async function nodeLaunchTarget(launcherPath: string): Promise<CodexLaunchTarget | undefined> {
  const launcher = await canonicalFile(launcherPath);
  if (launcher === undefined || !isOfficialNodeLauncher(launcher)) return undefined;
  const node = await canonicalFile(process.execPath);
  return node === undefined ? undefined : Object.freeze({ executable: node, prefixArgs: Object.freeze([launcher]) });
}

async function resolveExplicitLaunchTarget(path: string): Promise<CodexLaunchTarget | undefined> {
  const canonical = await canonicalFile(path);
  if (canonical === undefined) return undefined;
  const name = basename(canonical).toLowerCase();
  if (name === "codex.exe" || name === "codex") {
    return Object.freeze({ executable: canonical, prefixArgs: Object.freeze([]) });
  }
  if (name === "codex.js") return await nodeLaunchTarget(canonical);
  if (name !== "codex.cmd") return undefined;
  const shimDirectory = dirname(canonical);
  for (const candidate of [
    join(shimDirectory, "..", "@openai", "codex", "bin", "codex.js"),
    join(shimDirectory, "node_modules", "@openai", "codex", "bin", "codex.js"),
  ]) {
    const target = await nodeLaunchTarget(candidate);
    if (target !== undefined) return target;
  }
  return undefined;
}

export const defaultCodexLaunchTargetLocator: CodexLaunchTargetLocator = async (explicitPath) => {
  if (explicitPath !== undefined) {
    const target = await resolveExplicitLaunchTarget(explicitPath);
    return target === undefined
      ? { ok: false, error: { code: "host_unavailable" } }
      : { ok: true, value: target };
  }
  const pathValue = process.env.PATH;
  if (pathValue === undefined) return { ok: false, error: { code: "host_unavailable" } };
  const names = process.platform === "win32" ? ["codex.cmd", "codex.exe", "codex"] : ["codex"];
  const directories = pathValue.split(delimiter).filter((value) => value.length > 0).sort((left, right) => {
    const restricted = (value: string) => normalize(value).toLowerCase().includes("\\windowsapps");
    return Number(restricted(left)) - Number(restricted(right));
  });
  for (const directory of directories) {
    for (const name of names) {
      const target = await resolveExplicitLaunchTarget(join(directory, name));
      if (target !== undefined) return { ok: true, value: target };
    }
  }
  return { ok: false, error: { code: "host_unavailable" } };
};
export const defaultCodexExecutableLocator = defaultCodexLaunchTargetLocator;

export const defaultCodexProcessRunner: CodexProcessRunner = async (request) => await new Promise((resolve) => {
  let stdout = Buffer.alloc(0);
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let outputLimitExceeded = false;
  let settled = false;
  let timedOut = false;
  const child = spawn(request.executable, [...request.args], {
    cwd: request.cwd,
    shell: false,
    windowsHide: true,
    stdio: [request.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  const finish = (result: CodexProcessResult) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve(result);
  };
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, request.timeoutMs);
  child.stdout?.on("data", (chunk: Buffer) => {
    stdoutBytes += chunk.byteLength;
    if (stdoutBytes <= request.stdoutMaxBytes) stdout = Buffer.concat([stdout, chunk]);
    else { outputLimitExceeded = true; child.kill(); }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.byteLength;
    if (stderrBytes > request.stderrMaxBytes) { outputLimitExceeded = true; child.kill(); }
  });
  child.on("error", () => { finish({ kind: "unavailable", exitCode: null, stdout: "", stdoutBytes: 0, stderrBytes: 0, outputLimitExceeded: false }); });
  child.on("close", (exitCode) => {
    finish(timedOut
      ? { kind: "timeout", exitCode: null, stdout: stdout.toString("utf8"), stdoutBytes, stderrBytes, outputLimitExceeded }
      : { kind: "completed", exitCode, stdout: stdout.toString("utf8"), stdoutBytes, stderrBytes, outputLimitExceeded });
  });
  if (request.stdin !== undefined) child.stdin?.end(request.stdin);
});

function outputSchema(binding: CodexContextBinding): Readonly<Record<string, unknown>> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["projectId", "briefId", "briefVersionId", "authority", "canMutateAuthority"],
    properties: {
      projectId: { type: "string", const: binding.projectId },
      briefId: { type: "string", const: binding.briefId },
      briefVersionId: { type: "string", const: binding.briefVersionId },
      authority: { type: "string", const: "host_observation" },
      canMutateAuthority: { type: "boolean", const: false },
    },
  };
}

function trustOverride(projectRoot: string): string {
  return `projects.${JSON.stringify(projectRoot)}.trust_level="trusted"`;
}

export function codexMcpConfigArgs(config: CodexMcpLaunchConfig): readonly string[] {
  const values = [
    `mcp_servers.sestina.command=${JSON.stringify(config.command)}`,
    `mcp_servers.sestina.args=[${config.args.map((value) => JSON.stringify(value)).join(",")}]`,
    `mcp_servers.sestina.cwd=${JSON.stringify(config.cwd)}`,
    "mcp_servers.sestina.enabled=true",
    "mcp_servers.sestina.required=false",
    'mcp_servers.sestina.enabled_tools=["health","get_research_context"]',
    'mcp_servers.sestina.default_tools_approval_mode="writes"',
    "mcp_servers.sestina.startup_timeout_sec=10",
    "mcp_servers.sestina.tool_timeout_sec=5",
  ];
  return Object.freeze(values.flatMap((value) => ["-c", value]));
}

const VERIFICATION_PROMPT = [
  "Use the project Skill $sestina-research-integrity for this host verification.",
  "Call the sestina MCP tools health and get_research_context exactly once each.",
  "Do not write files, run shell commands, change research state, or make any user adjudication.",
  "Return only the structured projectId, briefId, and briefVersionId observed from get_research_context,",
  "with authority host_observation and canMutateAuthority false.",
].join(" ");

export async function verifyCodexHost(options: {
  readonly projectRoot: string;
  readonly binding: CodexContextBinding;
  readonly codexExecutable?: string;
  readonly mcpLaunch?: CodexMcpLaunchConfig;
  readonly executableLocator?: CodexExecutableLocator;
  readonly processRunner?: CodexProcessRunner;
}): Promise<CodexVerificationResult> {
  const located = await (options.executableLocator ?? defaultCodexLaunchTargetLocator)(options.codexExecutable);
  if (!located.ok) return located;
  const temporaryRoot = await mkdtemp(join(tmpdir(), "sestina-codex-host-"));
  const schemaPath = join(temporaryRoot, "verification.schema.json");
  const outputPath = join(temporaryRoot, "verification.output.json");
  try {
    await writeFile(schemaPath, `${JSON.stringify(outputSchema(options.binding))}\n`, { encoding: "utf8", flush: true });
    const codexArgs = [
      "exec",
      "--ephemeral",
      "--json",
      "--sandbox",
      "read-only",
      "--ignore-user-config",
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
      "-C",
      options.projectRoot,
      "-c",
      trustOverride(options.projectRoot),
      ...(options.mcpLaunch === undefined ? [] : codexMcpConfigArgs(options.mcpLaunch)),
      VERIFICATION_PROMPT,
    ];
    const processResult = await (options.processRunner ?? defaultCodexProcessRunner)({
      executable: located.value.executable,
      args: [...located.value.prefixArgs, ...codexArgs],
      cwd: options.projectRoot,
      shell: false,
      timeoutMs: CODEX_HOST_TIMEOUT_MS,
      stdoutMaxBytes: CODEX_HOST_STDOUT_MAX_BYTES,
      stderrMaxBytes: CODEX_HOST_STDERR_MAX_BYTES,
    });
    if (processResult.kind === "unavailable") return { ok: false, error: { code: "host_unavailable" } };
    if (processResult.kind === "timeout") return { ok: false, error: { code: "host_timeout", exitCode: null, stdoutBytes: processResult.stdoutBytes, stderrBytes: processResult.stderrBytes } };
    if (processResult.outputLimitExceeded) return { ok: false, error: { code: "host_protocol_mismatch", exitCode: processResult.exitCode, stdoutBytes: processResult.stdoutBytes, stderrBytes: processResult.stderrBytes } };
    if (processResult.exitCode !== 0) return { ok: false, error: { code: "host_process_failed", exitCode: processResult.exitCode, stdoutBytes: processResult.stdoutBytes, stderrBytes: processResult.stderrBytes } };
    let finalOutput: string;
    try { finalOutput = await readFile(outputPath, "utf8"); }
    catch { return { ok: false, error: { code: "host_protocol_mismatch", exitCode: processResult.exitCode, stdoutBytes: processResult.stdoutBytes, stderrBytes: processResult.stderrBytes } }; }
    return parseCodexVerificationEvidence(processResult.stdout, finalOutput, options.binding);
  } catch {
    return { ok: false, error: { code: "host_unavailable" } };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
