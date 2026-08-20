import type { ProjectReader } from "../project-reader.js";

export const SERVER_NAME = "sestina-mcp";
export const SERVER_VERSION = "0.1.0";
export const MCP_SDK_PACKAGE = "@modelcontextprotocol/server";
export const MCP_SDK_VERSION = "2.0.0";
export const MCP_PROTOCOL_REVISION = "2026-07-28";
export const CURRENT_BRIEF_URI = "sestina://brief/current";
export const TOOL_NAMES = Object.freeze(["health", "get_research_context"] as const);
export const RESOURCE_URIS = Object.freeze([CURRENT_BRIEF_URI] as const);

export interface McpLimits {
  readonly outputLimitBytes: number;
  readonly queryTimeoutMs: number;
}

export function healthPayload(reader: ProjectReader, limits: McpLimits): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schemaVersion: "1.0",
    ok: true,
    server: Object.freeze({ name: SERVER_NAME, version: SERVER_VERSION }),
    sdk: Object.freeze({ package: MCP_SDK_PACKAGE, version: MCP_SDK_VERSION }),
    protocol: Object.freeze({
      primaryRevision: MCP_PROTOCOL_REVISION,
      legacyNegotiation: "sdk_managed",
      transport: "stdio",
    }),
    mode: "read_only",
    project: reader.health(),
    capabilities: Object.freeze({
      tools: TOOL_NAMES,
      resources: RESOURCE_URIS,
      write: false,
      network: false,
      daemon: false,
    }),
    limits: Object.freeze({
      outputLimitBytes: limits.outputLimitBytes,
      queryTimeoutMs: limits.queryTimeoutMs,
    }),
  });
}
