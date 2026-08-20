import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";
import { openProjectReader, type ProjectReader } from "../src/project-reader.js";
import { mcpErr } from "../src/protocol-errors.js";
import { createSestinaMcpServer, SERVER_INSTRUCTIONS } from "../src/server.js";
import {
  CURRENT_BRIEF_URI,
  MCP_PROTOCOL_REVISION,
  SERVER_NAME,
  SERVER_VERSION,
} from "../src/tools/health.js";
import {
  createProjectFixture,
  readBriefRecordVersion,
  removeProjectFixture,
  updateActiveBrief,
} from "./fixture.js";

interface ConnectedContract {
  readonly client: Client;
  readonly close: () => Promise<void>;
}

const fixtureRoots: string[] = [];
const connections: ConnectedContract[] = [];

afterEach(async () => {
  for (const connection of connections.splice(0)) await connection.close();
  for (const root of fixtureRoots.splice(0)) await removeProjectFixture(root);
});

async function connect(root: string): Promise<ConnectedContract> {
  const reader = await openProjectReader({ projectRoot: root, outputLimitBytes: 32_768, queryTimeoutMs: 2_000 });
  if (!reader.ok) throw new Error(reader.error.code);
  return await connectReader(reader.value, { outputLimitBytes: 32_768, queryTimeoutMs: 2_000 });
}

async function connectReader(
  reader: ProjectReader,
  limits: { readonly outputLimitBytes: number; readonly queryTimeoutMs: number },
): Promise<ConnectedContract> {
  const server = createSestinaMcpServer(reader, limits);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "ri37-contract-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  let closed = false;
  const connected = {
    client,
    close: async () => {
      if (closed) return;
      closed = true;
      await client.close();
      await server.close();
      reader.close();
    },
  };
  connections.push(connected);
  return connected;
}

function textPayload(result: { readonly content: readonly unknown[] }): unknown {
  const item = result.content[0];
  if (typeof item !== "object" || item === null || !("type" in item) || item.type !== "text" || !("text" in item) || typeof item.text !== "string") {
    throw new Error("text_tool_result_required");
  }
  return JSON.parse(item.text) as unknown;
}

function resourcePayload(result: { readonly contents: readonly unknown[] }): unknown {
  const item = result.contents[0];
  if (typeof item !== "object" || item === null || !("text" in item) || typeof item.text !== "string") {
    throw new Error("text_resource_result_required");
  }
  return JSON.parse(item.text) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe.sequential("@sestina/mcp tool and resource contract", () => {
  it("discovers exactly two read-only tools and one fixed Brief resource", async () => {
    const fixture = await createProjectFixture();
    fixtureRoots.push(fixture.root);
    const { client } = await connect(fixture.root);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(["health", "get_research_context"]);
    for (const tool of tools.tools) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
    const resources = await client.listResources();
    expect(resources.resources.map((resource) => resource.uri)).toEqual([CURRENT_BRIEF_URI]);
    expect(resources.resources[0]?.mimeType).toBe("application/json");
    expect(SERVER_NAME).toBe("sestina-mcp");
    expect(SERVER_VERSION).toBe("0.1.0");
    expect(`${SERVER_NAME} ${SERVER_VERSION}`).not.toMatch(/spike|ri36/i);
  });

  it("returns stable path-free health without making unverifiable packaging claims", async () => {
    const fixture = await createProjectFixture();
    fixtureRoots.push(fixture.root);
    const { client } = await connect(fixture.root);
    const first = await client.callTool({ name: "health", arguments: {} });
    const second = await client.callTool({ name: "health", arguments: {} });
    expect(first.isError).not.toBe(true);
    expect(second.structuredContent).toEqual(first.structuredContent);
    expect(textPayload(first)).toEqual(first.structuredContent);
    expect(first.structuredContent).toMatchObject({
      schemaVersion: "1.0",
      ok: true,
      server: { name: SERVER_NAME, version: SERVER_VERSION },
      sdk: { package: "@modelcontextprotocol/server", version: "2.0.0" },
      protocol: { primaryRevision: MCP_PROTOCOL_REVISION, transport: "stdio" },
      mode: "read_only",
      project: {
        rootValidated: true,
        stateDatabaseInitialized: true,
        projectBinding: "single",
        readOnly: true,
      },
      capabilities: {
        tools: ["health", "get_research_context"],
        resources: [CURRENT_BRIEF_URI],
        prompts: [],
        resourceTemplates: [],
        write: false,
        network: false,
        daemon: false,
      },
      limits: {
        inboundJsonRpcMessageBytes: 65_536,
        researchTextBytes: 8_192,
        researchCollectionItems: 128,
        researchContext: {
          configuredBytes: 32_768,
          defaultBytes: 32_768,
          minimumBytes: 1_024,
          maximumBytes: 65_536,
        },
        mcpResultBytes: 262_144,
        queryTimeout: { configuredMs: 2_000, minimumMs: 1, maximumMs: 10_000 },
      },
    });
    expect(first.structuredContent).not.toHaveProperty("packaged");
    expect(JSON.stringify(first)).not.toContain(fixture.root);
    expect(JSON.stringify(first)).not.toContain(fixture.databasePath);
  });

  it("uses one canonical payload for the context tool and current Brief resource", async () => {
    const fixture = await createProjectFixture();
    fixtureRoots.push(fixture.root);
    const { client } = await connect(fixture.root);
    const before = await readBriefRecordVersion(fixture);
    const tool = await client.callTool({ name: "get_research_context", arguments: {} });
    const resource = await client.readResource({ uri: CURRENT_BRIEF_URI });
    const after = await readBriefRecordVersion(fixture);
    expect(tool.isError).not.toBe(true);
    expect(textPayload(tool)).toEqual(tool.structuredContent);
    expect(resourcePayload(resource)).toEqual(tool.structuredContent);
    expect(tool.structuredContent).toMatchObject({
      projectQuestion: "How can the current research task recover without replacing its goal?",
    });
    const structured = tool.structuredContent;
    if (!isRecord(structured)) throw new Error("structured_context_required");
    for (const field of ["fixedDecisions", "allowedChanges", "forbiddenChanges", "expectedDeltas", "evidenceBoundaries", "explicitNonGoals"]) {
      expect(Array.isArray(structured[field])).toBe(true);
    }
    expect(JSON.stringify({ tool, resource })).not.toContain(fixture.root);
    expect(after).toBe(before);
  });

  it("sees the newest active Brief through both surfaces without reconnecting", async () => {
    const fixture = await createProjectFixture();
    fixtureRoots.push(fixture.root);
    const { client } = await connect(fixture.root);
    const firstTool = await client.callTool({ name: "get_research_context", arguments: {} });
    const first = firstTool.structuredContent as { readonly version: number; readonly versionId: string };
    await updateActiveBrief(fixture);
    const secondTool = await client.callTool({ name: "get_research_context", arguments: {} });
    const secondResource = await client.readResource({ uri: CURRENT_BRIEF_URI });
    const second = secondTool.structuredContent as { readonly version: number; readonly versionId: string; readonly currentTask: string };
    expect(second.version).toBe(first.version + 1);
    expect(second.versionId).not.toBe(first.versionId);
    expect(second.currentTask).toBe("Add the newly bounded evidence comparison.");
    expect(resourcePayload(secondResource)).toEqual(secondTool.structuredContent);
  });

  it("rejects arguments, unknown capabilities, and every forbidden legacy write tool", async () => {
    const fixture = await createProjectFixture();
    fixtureRoots.push(fixture.root);
    const { client } = await connect(fixture.root);
    for (const name of ["health", "get_research_context"]) {
      const invalid = await client.callTool({ name, arguments: { unexpected: true } });
      expect(invalid.isError).toBe(true);
    }
    for (const name of [
      "start_revision_episode",
      "submit_candidate_revision",
      "run_revision_review",
      "propose_scope_change",
      "record_user_decision",
      "request_issue_transition",
      "create_research_snapshot",
      "unknown",
    ]) {
      await expect(client.callTool({ name, arguments: {} })).rejects.toThrow(/unknown|not found/i);
    }
    await expect(client.readResource({ uri: "sestina://research/other-brief" })).rejects.toThrow(/unknown|not found/i);
    expect(SERVER_INSTRUCTIONS).toContain("grants no write permission");
    expect(SERVER_INSTRUCTIONS).toContain("does not prove task completion or semantic correctness");
  });

  it("returns stable typed failures instead of inventing an inactive Brief", async () => {
    const fixture = await createProjectFixture({ activeBrief: false });
    fixtureRoots.push(fixture.root);
    const { client } = await connect(fixture.root);
    const tool = await client.callTool({ name: "get_research_context", arguments: {} });
    expect(tool.isError).toBe(true);
    expect(tool.structuredContent).toMatchObject({
      schemaVersion: "1.0",
      ok: false,
      error: { code: "no_active_brief" },
    });
    expect(textPayload(tool)).toEqual(tool.structuredContent);
    await expect(client.readResource({ uri: CURRENT_BRIEF_URI })).rejects.toThrow(/no_active_brief/);
  });

  it("preserves response-budget and query-timeout error codes on both protocol surfaces", async () => {
    const large = await createProjectFixture({ currentTask: "x".repeat(8_000) });
    fixtureRoots.push(large.root);
    const boundedReader = await openProjectReader({ projectRoot: large.root, outputLimitBytes: 1_024, queryTimeoutMs: 2_000 });
    expect(boundedReader.ok).toBe(true);
    if (!boundedReader.ok) return;
    const bounded = await connectReader(boundedReader.value, { outputLimitBytes: 1_024, queryTimeoutMs: 2_000 });
    const oversized = await bounded.client.callTool({ name: "get_research_context", arguments: {} });
    expect(oversized).toMatchObject({ isError: true, structuredContent: { error: { code: "response_too_large" } } });
    await expect(bounded.client.readResource({ uri: CURRENT_BRIEF_URI })).rejects.toThrow(/response_too_large/);

    const timeoutReader: ProjectReader = {
      health: () => ({ rootValidated: true, stateDatabaseInitialized: true, projectBinding: "single", readOnly: true }),
      readResearchContext: () => Promise.resolve(mcpErr("query_timeout")),
      readSerializedResearchContext: () => Promise.resolve(mcpErr("query_timeout")),
      close: () => undefined,
    };
    const timed = await connectReader(timeoutReader, { outputLimitBytes: 32_768, queryTimeoutMs: 1 });
    const timeout = await timed.client.callTool({ name: "get_research_context", arguments: {} });
    expect(timeout).toMatchObject({ isError: true, structuredContent: { error: { code: "query_timeout" } } });
    await expect(timed.client.readResource({ uri: CURRENT_BRIEF_URI })).rejects.toThrow(/query_timeout/);
  });
});
