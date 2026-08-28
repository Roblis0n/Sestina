import { StdioServerTransport, serveStdio } from "@modelcontextprotocol/server/stdio";
import { appendFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { createIdempotentShutdown } from "./lifecycle.js";
import {
  DEFAULT_OUTPUT_LIMIT_BYTES,
  DEFAULT_QUERY_TIMEOUT_MS,
  MAX_OUTPUT_LIMIT_BYTES,
  MAX_QUERY_TIMEOUT_MS,
  MIN_OUTPUT_LIMIT_BYTES,
  MIN_QUERY_TIMEOUT_MS,
  openProjectReader,
  openFrozenProjectReader,
} from "./project-reader.js";
import { mcpErr, type SestinaMcpResult } from "./protocol-errors.js";
import {
  isInboundLimitError,
  MAX_INBOUND_JSONRPC_MESSAGE_BYTES,
} from "./security/output-limits.js";
import { createSestinaMcpServer } from "./server.js";
import { SERVER_VERSION } from "./tools/health.js";

export interface ServerArguments {
  readonly projectRoot?: string;
  readonly frozenContextFile?: string;
  readonly expectedProjectId?: string;
  readonly expectedManifestHash?: string;
  readonly auditFile?: string;
  readonly outputLimitBytes: number;
  readonly queryTimeoutMs: number;
}

const OPTION_NAMES = Object.freeze([
  "--project-root",
  "--output-limit-bytes",
  "--query-timeout-ms",
  "--frozen-context-file",
  "--expected-project-id",
  "--expected-manifest-hash",
  "--audit-file",
] as const);

function boundedInteger(raw: string, minimum: number, maximum: number): number | undefined {
  if (!/^\d+$/u.test(raw)) return undefined;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : undefined;
}

export function parseServerArguments(args: readonly string[]): SestinaMcpResult<ServerArguments> {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (
      name === undefined
      || !OPTION_NAMES.includes(name as (typeof OPTION_NAMES)[number])
      || value === undefined
      || value.startsWith("--")
      || values.has(name)
    ) return mcpErr("invalid_arguments");
    values.set(name, value);
  }

  const projectRoot = values.get("--project-root");
  const frozenContextFile = values.get("--frozen-context-file");
  const expectedProjectId = values.get("--expected-project-id");
  const expectedManifestHash = values.get("--expected-manifest-hash");
  const auditFile = values.get("--audit-file");
  const normalMode = projectRoot !== undefined && frozenContextFile === undefined && expectedProjectId === undefined && expectedManifestHash === undefined && auditFile === undefined;
  const frozenMode = projectRoot === undefined && frozenContextFile !== undefined && expectedProjectId !== undefined && expectedManifestHash !== undefined && auditFile !== undefined;
  if ((!normalMode && !frozenMode) || (normalMode && projectRoot?.trim().length === 0)
    || (frozenMode && (!isAbsolute(frozenContextFile) || !isAbsolute(auditFile) || expectedProjectId.trim().length === 0 || !/^[0-9a-f]{64}$/u.test(expectedManifestHash)))) {
    return mcpErr("missing_project_root");
  }
  const outputRaw = values.get("--output-limit-bytes");
  const timeoutRaw = values.get("--query-timeout-ms");
  const outputLimitBytes = outputRaw === undefined
    ? DEFAULT_OUTPUT_LIMIT_BYTES
    : boundedInteger(outputRaw, MIN_OUTPUT_LIMIT_BYTES, MAX_OUTPUT_LIMIT_BYTES);
  const queryTimeoutMs = timeoutRaw === undefined
    ? DEFAULT_QUERY_TIMEOUT_MS
    : boundedInteger(timeoutRaw, MIN_QUERY_TIMEOUT_MS, MAX_QUERY_TIMEOUT_MS);
  if (outputLimitBytes === undefined || queryTimeoutMs === undefined) {
    return mcpErr("invalid_arguments");
  }
  return {
    ok: true,
    value: Object.freeze({
      ...(normalMode ? { projectRoot } : { frozenContextFile, expectedProjectId, expectedManifestHash, auditFile }),
      outputLimitBytes,
      queryTimeoutMs,
    }),
  };
}

function diagnostic(value: Readonly<Record<string, unknown>>): void {
  process.stderr.write(`${JSON.stringify(value)}\n`);
}

const parsed = parseServerArguments(process.argv.slice(2));
if (!parsed.ok) {
  diagnostic({ event: "startup_failed", code: parsed.error.code });
  process.exitCode = 64;
} else {
  let frozenPathsValid = true;
  if (parsed.value.frozenContextFile !== undefined && parsed.value.auditFile !== undefined) {
    const contextParent = await realpath(dirname(parsed.value.frozenContextFile)).catch(() => undefined);
    const auditParent = await realpath(dirname(parsed.value.auditFile)).catch(() => undefined);
    frozenPathsValid = contextParent !== undefined && contextParent === auditParent;
  }
  const reader = !frozenPathsValid
    ? mcpErr<import("./project-reader.js").ProjectReader<object>>("invalid_arguments")
    : parsed.value.frozenContextFile === undefined
      ? await openProjectReader({ projectRoot: parsed.value.projectRoot ?? "", outputLimitBytes: parsed.value.outputLimitBytes, queryTimeoutMs: parsed.value.queryTimeoutMs })
      : await openFrozenProjectReader({ contextFile: parsed.value.frozenContextFile, expectedProjectId: parsed.value.expectedProjectId ?? "", expectedManifestHash: parsed.value.expectedManifestHash ?? "", outputLimitBytes: parsed.value.outputLimitBytes, queryTimeoutMs: parsed.value.queryTimeoutMs });
  if (!reader.ok) {
    diagnostic({ event: "startup_failed", code: reader.error.code });
    process.exitCode = 66;
  } else {
    const projectReader = reader.value;
    const transport = new StdioServerTransport(process.stdin, process.stdout, {
      maxBufferSize: MAX_INBOUND_JSONRPC_MESSAGE_BYTES,
    });
    const transportLifecycle: { handle?: ReturnType<typeof serveStdio> } = {};
    const close = createIdempotentShutdown(
      async () => { await transportLifecycle.handle?.close(); },
      () => { projectReader.close(); },
      () => { process.stdin.pause(); },
    );
    const auditBinding = projectReader.auditBinding?.();
    const audit = parsed.value.auditFile === undefined || auditBinding === undefined ? undefined : async (tool: "health" | "get_research_context") => {
      await appendFile(parsed.value.auditFile ?? "", `${JSON.stringify({ tool, ...auditBinding })}\n`, { encoding: "utf8", flag: "a" });
    };
    transportLifecycle.handle = serveStdio(
      () => createSestinaMcpServer(projectReader, parsed.value, audit),
      {
        transport,
        onerror: (error) => {
          const inputTooLarge = isInboundLimitError(error);
          diagnostic({
            event: "transport_error",
            code: inputTooLarge ? "input_too_large" : "malformed_or_invalid_jsonrpc",
          });
          if (inputTooLarge) {
            process.exitCode = 65;
            void close().finally(() => { process.stdin.destroy(); });
          }
        },
      },
    );
    process.stdin.once("end", () => { void close(); });
    process.once("SIGINT", () => { void close(); });
    process.once("SIGTERM", () => { void close(); });
    diagnostic({
      event: "ready",
      transport: "stdio",
      mode: "read_only",
      serverVersion: SERVER_VERSION,
    });
  }
}
