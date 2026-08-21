import { getReleaseIdentity } from "@sestina/core";
import type { ProjectReader } from "../project-reader.js";
import { CAPABILITY_POLICY } from "../security/capability-policy.js";
import {
  DEFAULT_RESEARCH_CONTEXT_BUDGET_BYTES,
  MAX_INBOUND_JSONRPC_MESSAGE_BYTES,
  MAX_MCP_RESULT_BYTES,
  MAX_QUERY_TIMEOUT_MS,
  MAX_RESEARCH_COLLECTION_ITEMS,
  MAX_RESEARCH_CONTEXT_BUDGET_BYTES,
  MAX_RESEARCH_TEXT_BYTES,
  MIN_QUERY_TIMEOUT_MS,
  MIN_RESEARCH_CONTEXT_BUDGET_BYTES,
} from "../security/output-limits.js";

export const SERVER_NAME = "sestina-mcp";
export const SERVER_VERSION = getReleaseIdentity().mcpServerVersion;
export const MCP_SDK_PACKAGE = "@modelcontextprotocol/server";
export const MCP_SDK_VERSION = "2.0.0";
export const MCP_PROTOCOL_REVISION = "2026-07-28";
export const CURRENT_BRIEF_URI = CAPABILITY_POLICY.resources[0];
export const TOOL_NAMES = CAPABILITY_POLICY.tools;
export const RESOURCE_URIS = CAPABILITY_POLICY.resources;

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
      prompts: CAPABILITY_POLICY.prompts,
      resourceTemplates: CAPABILITY_POLICY.resourceTemplates,
      write: CAPABILITY_POLICY.write,
      network: CAPABILITY_POLICY.network,
      daemon: CAPABILITY_POLICY.daemon,
    }),
    limits: Object.freeze({
      inboundJsonRpcMessageBytes: MAX_INBOUND_JSONRPC_MESSAGE_BYTES,
      researchTextBytes: MAX_RESEARCH_TEXT_BYTES,
      researchCollectionItems: MAX_RESEARCH_COLLECTION_ITEMS,
      researchContext: Object.freeze({
        configuredBytes: limits.outputLimitBytes,
        defaultBytes: DEFAULT_RESEARCH_CONTEXT_BUDGET_BYTES,
        minimumBytes: MIN_RESEARCH_CONTEXT_BUDGET_BYTES,
        maximumBytes: MAX_RESEARCH_CONTEXT_BUDGET_BYTES,
      }),
      mcpResultBytes: MAX_MCP_RESULT_BYTES,
      queryTimeout: Object.freeze({
        configuredMs: limits.queryTimeoutMs,
        minimumMs: MIN_QUERY_TIMEOUT_MS,
        maximumMs: MAX_QUERY_TIMEOUT_MS,
      }),
    }),
  });
}
