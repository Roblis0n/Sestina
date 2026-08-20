import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CODEX_HOST_FINAL_MAX_BYTES,
  CODEX_HOST_JSONL_MAX_LINES,
  CODEX_HOST_STDERR_MAX_BYTES,
  CODEX_HOST_STDOUT_MAX_BYTES,
  CODEX_HOST_TIMEOUT_MS,
  codexMcpConfigArgs,
  defaultCodexLaunchTargetLocator,
  defaultCodexProcessRunner,
} from "../../../apps/cli/src/connections/codex-host-verifier.js";
import { defaultCodexRuntimeLocator, validateCodexRuntime } from "../../../apps/cli/src/connections/runtime-locator.js";

export interface RealCodexSessionResult {
  readonly events: readonly Readonly<Record<string, unknown>>[];
  readonly final: Readonly<Record<string, unknown>>;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
}

function trustOverride(projectRoot: string): string {
  return `projects.${JSON.stringify(projectRoot)}.trust_level="trusted"`;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function observedSestinaTools(events: readonly Readonly<Record<string, unknown>>[]): readonly string[] {
  const observed = new Set<string>();
  for (const event of events) {
    if (event.type !== "item.completed" || !record(event.item)) continue;
    if (event.item.type !== "mcp_tool_call" || event.item.server !== "sestina" || event.item.status !== "completed" || event.item.error !== null) continue;
    if (typeof event.item.tool === "string") observed.add(event.item.tool);
  }
  return [...observed].sort();
}

export async function runRealCodexSession(options: {
  readonly cwd: string;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly prompt?: string;
  readonly stdinContext?: string;
  readonly trustProject?: boolean;
}): Promise<RealCodexSessionResult> {
  if ((options.prompt === undefined) === (options.stdinContext === undefined)) throw new Error("codex_session_requires_exactly_one_input");
  const located = await defaultCodexLaunchTargetLocator(process.env.SESTINA_CODEX_EXECUTABLE);
  if (!located.ok) throw new Error("host_unavailable");
  const runtime = options.trustProject === false ? undefined : await validateCodexRuntime(defaultCodexRuntimeLocator);
  if (runtime !== undefined && !runtime.ok) throw new Error("runtime_unavailable");
  const temporaryRoot = await mkdtemp(join(tmpdir(), "sestina-real-codex-"));
  const schemaPath = join(temporaryRoot, "output.schema.json");
  const outputPath = join(temporaryRoot, "output.json");
  try {
    await writeFile(schemaPath, `${JSON.stringify(options.schema)}\n`, { encoding: "utf8", flush: true });
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
      options.cwd,
      ...(options.trustProject === false ? [] : ["-c", trustOverride(options.cwd)]),
      ...(runtime === undefined ? [] : codexMcpConfigArgs({
        command: runtime.value.nodeExecutable,
        args: [runtime.value.serverEntry, "--project-root", options.cwd],
        cwd: options.cwd,
      })),
      ...(options.prompt === undefined ? [] : [options.prompt]),
    ];
    const completed = await defaultCodexProcessRunner({
      executable: located.value.executable,
      args: [...located.value.prefixArgs, ...codexArgs],
      cwd: options.cwd,
      shell: false,
      ...(options.stdinContext === undefined ? {} : { stdin: options.stdinContext }),
      timeoutMs: CODEX_HOST_TIMEOUT_MS,
      stdoutMaxBytes: CODEX_HOST_STDOUT_MAX_BYTES,
      stderrMaxBytes: CODEX_HOST_STDERR_MAX_BYTES,
    });
    if (completed.kind === "timeout") throw new Error("host_timeout");
    if (completed.kind === "unavailable") throw new Error("host_unavailable");
    if (completed.outputLimitExceeded) throw new Error("host_protocol_mismatch");
    if (completed.exitCode !== 0) throw new Error("host_process_failed");
    const lines = completed.stdout.split(/\r?\n/u).filter((line) => line.length > 0);
    if (lines.length > CODEX_HOST_JSONL_MAX_LINES) throw new Error("host_protocol_mismatch");
    const events: Readonly<Record<string, unknown>>[] = [];
    for (const line of lines) {
      let parsed: unknown;
      try { parsed = JSON.parse(line) as unknown; } catch { throw new Error("host_protocol_mismatch"); }
      if (!record(parsed) || typeof parsed.type !== "string") throw new Error("host_protocol_mismatch");
      events.push(parsed);
    }
    const finalText = await readFile(outputPath, "utf8").catch(() => "");
    if (Buffer.byteLength(finalText, "utf8") > CODEX_HOST_FINAL_MAX_BYTES) throw new Error("host_protocol_mismatch");
    let final: unknown;
    try { final = JSON.parse(finalText) as unknown; } catch { throw new Error("host_protocol_mismatch"); }
    if (!record(final)) throw new Error("host_protocol_mismatch");
    return { events, final, stdoutBytes: completed.stdoutBytes, stderrBytes: completed.stderrBytes };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
