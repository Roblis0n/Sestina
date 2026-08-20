import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { openSestina } from "@sestina/core";
import { describe, expect, it } from "vitest";
import type { ProjectReader } from "../src/project-reader.js";
import { mcpOk } from "../src/protocol-errors.js";
import { readCurrentBriefResource } from "../src/resources/current-brief.js";
import {
  DEFAULT_RESEARCH_CONTEXT_BUDGET_BYTES,
  MAX_INBOUND_JSONRPC_MESSAGE_BYTES,
  MAX_MCP_RESULT_BYTES,
  MAX_RESEARCH_COLLECTION_ITEMS,
  MAX_RESEARCH_CONTEXT_BUDGET_BYTES,
  MAX_RESEARCH_TEXT_BYTES,
  MIN_RESEARCH_CONTEXT_BUDGET_BYTES,
  serializeResearchContext,
  utf8ByteLength,
  validateResearchText,
} from "../src/security/output-limits.js";
import { createSestinaMcpServer } from "../src/server.js";
import { getResearchContext } from "../src/tools/get-research-context.js";
import { createProjectFixture, removeProjectFixture } from "./fixture.js";

describe.sequential("@sestina/mcp exact UTF-8 and result limits", () => {
  it("exports the locked production byte, collection, context, and result limits", () => {
    expect(MAX_INBOUND_JSONRPC_MESSAGE_BYTES).toBe(65_536);
    expect(MAX_RESEARCH_TEXT_BYTES).toBe(8_192);
    expect(MAX_RESEARCH_COLLECTION_ITEMS).toBe(128);
    expect(DEFAULT_RESEARCH_CONTEXT_BUDGET_BYTES).toBe(32_768);
    expect(MIN_RESEARCH_CONTEXT_BUDGET_BYTES).toBe(1_024);
    expect(MAX_RESEARCH_CONTEXT_BUDGET_BYTES).toBe(65_536);
    expect(MAX_MCP_RESULT_BYTES).toBe(262_144);
  });

  it("uses UTF-8 bytes for exact ASCII, Chinese, and emoji text boundaries", () => {
    const exactAscii = "a".repeat(MAX_RESEARCH_TEXT_BYTES);
    expect(utf8ByteLength(exactAscii)).toBe(MAX_RESEARCH_TEXT_BYTES);
    expect(validateResearchText(exactAscii).ok).toBe(true);
    expect(validateResearchText(`${exactAscii}a`)).toMatchObject({ ok: false, error: { code: "response_too_large" } });

    const multilingual = `${"中".repeat(2_728)}😀abcd`;
    expect(utf8ByteLength(multilingual)).toBe(MAX_RESEARCH_TEXT_BYTES);
    expect(validateResearchText(multilingual).ok).toBe(true);
    expect(validateResearchText(`${multilingual}中`)).toMatchObject({ ok: false, error: { code: "response_too_large" } });
  });

  it("fails closed for a single oversized field, more than 128 items, and total context overflow", async () => {
    const oversizedText = await createProjectFixture({ currentTask: "x".repeat(MAX_RESEARCH_TEXT_BYTES + 1) });
    const totalOverflow = await createProjectFixture({
      projectQuestion: "q".repeat(800),
      currentTask: "t".repeat(800),
      explicitNonGoals: ["n".repeat(800)],
    });
    try {
      for (const [fixture, outputLimitBytes] of [
        [oversizedText, MAX_RESEARCH_CONTEXT_BUDGET_BYTES],
        [totalOverflow, MIN_RESEARCH_CONTEXT_BUDGET_BYTES],
      ] as const) {
        const opened = await import("../src/project-reader.js").then(async ({ openProjectReader }) => await openProjectReader({
          projectRoot: fixture.root,
          outputLimitBytes,
          queryTimeoutMs: 2_000,
        }));
        expect(opened.ok).toBe(true);
        if (!opened.ok) continue;
        await expect(opened.value.readResearchContext()).resolves.toMatchObject({
          ok: false,
          error: { code: "response_too_large" },
        });
        opened.value.close();
      }

      const core = await openSestina({ databasePath: totalOverflow.databasePath, readOnly: true });
      if (!core.ok) throw new Error(core.error.code);
      try {
        const state = core.value.getBriefState(totalOverflow.projectId);
        if (!state.ok || state.value === undefined) throw new Error("brief_state_required");
        const synthetic = {
          ...state.value,
          version: {
            ...state.value.version,
            targetArtifacts: Array.from(
              { length: MAX_RESEARCH_COLLECTION_ITEMS + 1 },
              (_value, index) => `artifact-${index}`,
            ),
          },
        };
        expect(serializeResearchContext(synthetic, MAX_RESEARCH_CONTEXT_BUDGET_BYTES)).toMatchObject({
          ok: false,
          error: { code: "response_too_large" },
        });
      } finally {
        core.value.close();
      }
    } finally {
      await removeProjectFixture(oversizedText.root);
      await removeProjectFixture(totalOverflow.root);
    }
  });

  it("checks the complete tool and resource result object and never leaks oversized attack text", async () => {
    const attack = `DO-NOT-LOG-${"z".repeat(MAX_MCP_RESULT_BYTES)}`;
    const reader = {
      health: () => ({ rootValidated: true, stateDatabaseInitialized: true, projectBinding: "single", readOnly: true }),
      readSerializedResearchContext: () => Promise.resolve(mcpOk({
        payload: Object.freeze({ schemaVersion: "1.0" }),
        json: JSON.stringify({ attack }),
        bytes: utf8ByteLength(JSON.stringify({ attack })),
      })),
      close: () => undefined,
    } as unknown as ProjectReader;

    const tool = await getResearchContext(reader);
    expect(tool).toMatchObject({ isError: true, structuredContent: { error: { code: "response_too_large" } } });
    expect(JSON.stringify(tool)).not.toContain("DO-NOT-LOG");
    await expect(readCurrentBriefResource(reader, new URL("sestina://brief/current")))
      .rejects.toThrow(/response_too_large/u);
  });

  it("applies the same response_too_large outcome to the live tool and resource", async () => {
    const fixture = await createProjectFixture({ currentTask: "x".repeat(MAX_RESEARCH_TEXT_BYTES + 1) });
    const { openProjectReader } = await import("../src/project-reader.js");
    const reader = await openProjectReader({ projectRoot: fixture.root, outputLimitBytes: MAX_RESEARCH_CONTEXT_BUDGET_BYTES, queryTimeoutMs: 2_000 });
    expect(reader.ok).toBe(true);
    if (!reader.ok) return;
    const server = createSestinaMcpServer(reader.value, { outputLimitBytes: MAX_RESEARCH_CONTEXT_BUDGET_BYTES, queryTimeoutMs: 2_000 });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "ri38-limits", version: "1.0.0" });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const tool = await client.callTool({ name: "get_research_context", arguments: {} });
      expect(tool).toMatchObject({ isError: true, structuredContent: { error: { code: "response_too_large" } } });
      await expect(client.readResource({ uri: "sestina://brief/current" })).rejects.toThrow(/response_too_large/u);
    } finally {
      await client.close();
      await server.close();
      reader.value.close();
      await removeProjectFixture(fixture.root);
    }
  });

});
