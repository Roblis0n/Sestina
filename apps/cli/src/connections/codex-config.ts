import { isAbsolute } from "node:path";
import { parse, stringify } from "smol-toml";

export const MANAGED_BLOCK_START = "# >>> sestina managed codex mcp";
export const MANAGED_BLOCK_END = "# <<< sestina managed codex mcp";

export interface CodexMcpRuntimeConfig {
  readonly nodeExecutable: string;
  readonly serverEntry: string;
  readonly projectRoot: string;
}

export type CodexConfigStatus = "not_configured" | "configured" | "drifted" | "conflict";

export type CodexConfigMutationResult =
  | {
    readonly ok: true;
    readonly value: {
      readonly content: string;
      readonly changed: boolean;
      readonly managedBlock: string;
    };
  }
  | { readonly ok: false; readonly error: { readonly code: "state_conflict" } };

export type CodexConfigRemovalResult =
  | {
    readonly ok: true;
    readonly value: {
      readonly content: string;
      readonly changed: boolean;
      readonly deleteFile: boolean;
    };
  }
  | { readonly ok: false; readonly error: { readonly code: "state_conflict" } };

interface ManagedRange {
  readonly start: number;
  readonly end: number;
  readonly block: string;
  readonly body: string;
}

function conflict(): { readonly ok: false; readonly error: { readonly code: "state_conflict" } } {
  return { ok: false, error: { code: "state_conflict" } };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDocument(source: string): Record<string, unknown> | undefined {
  try {
    const value = parse(source) as unknown;
    return record(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function markerMatches(source: string, marker: string): readonly RegExpMatchArray[] {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return [...source.matchAll(new RegExp(`^${escaped}\\r?$`, "gmu"))];
}

function managedRange(source: string): ManagedRange | undefined | "conflict" {
  const starts = markerMatches(source, MANAGED_BLOCK_START);
  const ends = markerMatches(source, MANAGED_BLOCK_END);
  if (starts.length === 0 && ends.length === 0) return undefined;
  if (starts.length !== 1 || ends.length !== 1) return "conflict";
  const start = starts[0]?.index;
  const endMarkerStart = ends[0]?.index;
  if (start === undefined || endMarkerStart === undefined || start >= endMarkerStart) return "conflict";
  const endMatch = ends[0]?.[0];
  if (endMatch === undefined) return "conflict";
  let end = endMarkerStart + endMatch.length;
  if (source.slice(end, end + 2) === "\r\n") end += 2;
  else if (source[end] === "\n") end += 1;
  const startLineEnd = source.indexOf("\n", start);
  if (startLineEnd < 0 || startLineEnd >= endMarkerStart) return "conflict";
  const body = source.slice(startLineEnd + 1, endMarkerStart);
  return { start, end, block: source.slice(start, end), body };
}

function sestinaTable(document: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!record(document.mcp_servers)) return undefined;
  const value = document.mcp_servers.sestina;
  return record(value) ? value : undefined;
}

function hasForeignSestinaTable(document: Record<string, unknown>): boolean {
  return record(document.mcp_servers) && document.mcp_servers.sestina !== undefined;
}

function expectedTable(options: CodexMcpRuntimeConfig): Record<string, unknown> {
  return {
    command: options.nodeExecutable,
    args: [options.serverEntry, "--project-root", options.projectRoot],
    cwd: options.projectRoot,
    enabled: true,
    required: false,
    enabled_tools: ["health", "get_research_context"],
    default_tools_approval_mode: "writes",
    startup_timeout_sec: 10,
    tool_timeout_sec: 5,
  };
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function bodyOwnsOnlySestina(body: string): boolean {
  const parsed = parseDocument(body);
  if (parsed === undefined || Object.keys(parsed).length !== 1 || !record(parsed.mcp_servers)) return false;
  return Object.keys(parsed.mcp_servers).length === 1 && record(parsed.mcp_servers.sestina);
}

function validOptions(options: CodexMcpRuntimeConfig): boolean {
  return isAbsolute(options.nodeExecutable) && isAbsolute(options.serverEntry) && isAbsolute(options.projectRoot);
}

export function renderSestinaManagedBlock(options: CodexMcpRuntimeConfig): string {
  if (!validOptions(options)) throw new Error("invalid_config_input");
  const body = stringify({ mcp_servers: { sestina: expectedTable(options) } }).replaceAll("\r\n", "\n").replace(/\n*$/u, "");
  return `${MANAGED_BLOCK_START}\n${body}\n${MANAGED_BLOCK_END}\n`;
}

export function inspectCodexConfig(source: string, options?: CodexMcpRuntimeConfig): { readonly status: CodexConfigStatus } {
  const parsed = parseDocument(source);
  if (parsed === undefined) return { status: "conflict" };
  const range = managedRange(source);
  if (range === "conflict") return { status: "conflict" };
  if (range === undefined) return { status: hasForeignSestinaTable(parsed) ? "conflict" : "not_configured" };
  if (!bodyOwnsOnlySestina(range.body) || sestinaTable(parsed) === undefined) return { status: "conflict" };
  if (options === undefined) return { status: "configured" };
  if (!validOptions(options)) return { status: "conflict" };
  return { status: range.block.replaceAll("\r\n", "\n") === renderSestinaManagedBlock(options)
    ? "configured"
    : "drifted" };
}

export function renderManagedCodexConfig(source: string, options: CodexMcpRuntimeConfig): CodexConfigMutationResult {
  if (!validOptions(options)) return conflict();
  const parsed = parseDocument(source);
  if (parsed === undefined) return conflict();
  const range = managedRange(source);
  if (range === "conflict") return conflict();
  const managedBlock = renderSestinaManagedBlock(options);
  let content: string;
  if (range === undefined) {
    if (hasForeignSestinaTable(parsed)) return conflict();
    const separator = source.length === 0 || source.endsWith("\n") ? "" : "\n";
    content = `${source}${separator}${managedBlock}`;
  } else {
    if (!bodyOwnsOnlySestina(range.body) || sestinaTable(parsed) === undefined) return conflict();
    content = `${source.slice(0, range.start)}${managedBlock}${source.slice(range.end)}`;
  }
  const reparsed = parseDocument(content);
  if (reparsed === undefined || !jsonEqual(sestinaTable(reparsed), expectedTable(options))) return conflict();
  return { ok: true, value: { content, changed: content !== source, managedBlock } };
}

export function removeManagedCodexConfig(source: string): CodexConfigRemovalResult {
  const parsed = parseDocument(source);
  if (parsed === undefined) return conflict();
  const range = managedRange(source);
  if (range === "conflict") return conflict();
  if (range === undefined) {
    if (hasForeignSestinaTable(parsed)) return conflict();
    return { ok: true, value: { content: source, changed: false, deleteFile: false } };
  }
  if (!bodyOwnsOnlySestina(range.body) || sestinaTable(parsed) === undefined) return conflict();
  const content = `${source.slice(0, range.start)}${source.slice(range.end)}`;
  if (parseDocument(content) === undefined) return conflict();
  return { ok: true, value: { content, changed: true, deleteFile: content.trim().length === 0 } };
}
