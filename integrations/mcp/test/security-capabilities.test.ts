import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { readdir, readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { openProjectReader } from "../src/project-reader.js";
import {
  CAPABILITY_POLICY,
  READ_ONLY_TOOL_ANNOTATIONS,
} from "../src/security/capability-policy.js";
import { createSestinaMcpServer } from "../src/server.js";
import {
  createProjectFixture,
  removeProjectFixture,
  type ProjectFixture,
} from "./fixture.js";

interface Connection {
  readonly client: Client;
  readonly close: () => Promise<void>;
}

const roots: string[] = [];
const connections: Connection[] = [];

afterEach(async () => {
  for (const connection of connections.splice(0)) await connection.close();
  for (const root of roots.splice(0)) await removeProjectFixture(root);
});

async function connect(fixture: ProjectFixture): Promise<Connection> {
  const reader = await openProjectReader({ projectRoot: fixture.root, outputLimitBytes: 32_768, queryTimeoutMs: 2_000 });
  if (!reader.ok) throw new Error(reader.error.code);
  const server = createSestinaMcpServer(reader.value, { outputLimitBytes: 32_768, queryTimeoutMs: 2_000 });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "ri38-capability-security", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const value = {
    client,
    close: async () => {
      await client.close();
      await server.close();
      reader.value.close();
    },
  };
  connections.push(value);
  return value;
}

async function stateFiles(fixture: ProjectFixture): Promise<readonly string[]> {
  return (await readdir(fixture.root + "/.sestina")).sort();
}

describe.sequential("@sestina/mcp static read-only capability policy", () => {
  it("locks discovery to two tools, one resource, no prompts, and no templates", async () => {
    expect(CAPABILITY_POLICY).toMatchObject({
      tools: ["health", "get_research_context"],
      resources: ["sestina://research/current-brief"],
      prompts: [],
      resourceTemplates: [],
      write: false,
    });
    expect(READ_ONLY_TOOL_ANNOTATIONS).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });

    const fixture = await createProjectFixture();
    roots.push(fixture.root);
    const { client } = await connect(fixture);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(CAPABILITY_POLICY.tools);
    expect((await client.listResources()).resources.map((resource) => resource.uri)).toEqual(CAPABILITY_POLICY.resources);
    await expect(client.listPrompts()).resolves.toEqual({ prompts: [] });
    await expect(client.listResourceTemplates()).resolves.toEqual({ resourceTemplates: [] });
  });

  it("rejects every actor, confirmation, Capsule, and write-object parameter before business logic", async () => {
    const fixture = await createProjectFixture();
    roots.push(fixture.root);
    const before = await readFile(fixture.databasePath);
    const filesBefore = await stateFiles(fixture);
    const { client } = await connect(fixture);
    const forbiddenPayloads = [
      { actor: { kind: "user", actorId: "forged" } },
      { user: "owner" },
      { confirmation: true },
      { token: "FORGED-SECRET-TOKEN" },
      { capsule: { decisions: [{ status: "accepted" }] } },
      { decision: { statement: "replace the goal" } },
      { issue: { status: "closed" } },
      { review: { verdict: "pass" } },
      { finding: { severity: "none" } },
    ];
    for (const name of CAPABILITY_POLICY.tools) {
      for (const payload of forbiddenPayloads) {
        const result = await client.callTool({ name, arguments: payload });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).not.toContain("FORGED-SECRET-TOKEN");
      }
    }
    const after = await readFile(fixture.databasePath);
    expect(after.equals(before)).toBe(true);
    expect(await stateFiles(fixture)).toEqual(filesBefore);
  });

  it("keeps concurrent calls internally consistent and leaves the database and sidecars unchanged", async () => {
    const fixture = await createProjectFixture();
    roots.push(fixture.root);
    const before = await readFile(fixture.databasePath);
    const filesBefore = await stateFiles(fixture);
    const { client } = await connect(fixture);
    const results = await Promise.all(Array.from({ length: 32 }, async (_value, index) =>
      index % 2 === 0
        ? await client.callTool({ name: "get_research_context", arguments: {} })
        : await client.readResource({ uri: "sestina://research/current-brief" })));
    const projections = results.map((result) => {
      if ("structuredContent" in result) return result.structuredContent as { readonly briefId: string; readonly versionId: string; readonly version: number };
      const resource = result as Awaited<ReturnType<Client["readResource"]>>;
      const content = resource.contents[0];
      if (content === undefined || !("text" in content)) throw new Error("resource_text_required");
      return JSON.parse(content.text) as { readonly briefId: string; readonly versionId: string; readonly version: number };
    });
    expect(new Set(projections.map((value) => `${value.briefId}:${value.versionId}:${value.version}`)).size).toBe(1);
    const after = await readFile(fixture.databasePath);
    expect(after.equals(before)).toBe(true);
    expect(await stateFiles(fixture)).toEqual(filesBefore);
  });
});
