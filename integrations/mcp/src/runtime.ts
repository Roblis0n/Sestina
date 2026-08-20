import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createIdempotentShutdown } from "./lifecycle.js";
import {
  DEFAULT_OUTPUT_LIMIT_BYTES,
  DEFAULT_QUERY_TIMEOUT_MS,
  MAX_OUTPUT_LIMIT_BYTES,
  MAX_QUERY_TIMEOUT_MS,
  MIN_OUTPUT_LIMIT_BYTES,
  MIN_QUERY_TIMEOUT_MS,
  openProjectReader,
} from "./project-reader.js";
import { mcpErr, type SestinaMcpResult } from "./protocol-errors.js";
import { createSestinaMcpServer } from "./server.js";
import { SERVER_VERSION } from "./tools/health.js";

export interface ServerArguments {
  readonly projectRoot: string;
  readonly outputLimitBytes: number;
  readonly queryTimeoutMs: number;
}

const OPTION_NAMES = Object.freeze([
  "--project-root",
  "--output-limit-bytes",
  "--query-timeout-ms",
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
  if (projectRoot === undefined || projectRoot.trim().length === 0) {
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
    value: Object.freeze({ projectRoot, outputLimitBytes, queryTimeoutMs }),
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
  const reader = await openProjectReader(parsed.value);
  if (!reader.ok) {
    diagnostic({ event: "startup_failed", code: reader.error.code });
    process.exitCode = 66;
  } else {
    const handle = serveStdio(
      () => createSestinaMcpServer(reader.value, parsed.value),
      {
        onerror: () => {
          diagnostic({ event: "transport_error", code: "malformed_or_invalid_jsonrpc" });
        },
      },
    );
    const close = createIdempotentShutdown(
      async () => { await handle.close(); },
      () => { reader.value.close(); },
      () => { process.stdin.pause(); },
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
