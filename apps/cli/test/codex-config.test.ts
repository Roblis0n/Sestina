import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import {
  inspectCodexConfig,
  removeManagedCodexConfig,
  renderManagedCodexConfig,
  renderSestinaManagedBlock,
} from "../src/connections/codex-config.js";

const runtime = {
  nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
  serverEntry: "C:\\工具 目录\\sestina-mcp\\dist\\main.js",
  projectRoot: "C:\\研究 项目\\论文😀",
};

describe("Codex managed MCP block", () => {
  it("renders the exact bounded read-only configuration as parseable TOML", () => {
    const block = renderSestinaManagedBlock(runtime);
    expect(block).toMatchInlineSnapshot(`
      "# >>> sestina managed codex mcp
      [mcp_servers.sestina]
      command = "C:\\\\Program Files\\\\nodejs\\\\node.exe"
      args = [ "C:\\\\工具 目录\\\\sestina-mcp\\\\dist\\\\main.js", "--project-root", "C:\\\\研究 项目\\\\论文😀" ]
      cwd = "C:\\\\研究 项目\\\\论文😀"
      enabled = true
      required = false
      enabled_tools = [ "health", "get_research_context" ]
      default_tools_approval_mode = "writes"
      startup_timeout_sec = 10
      tool_timeout_sec = 5
      # <<< sestina managed codex mcp
      "
    `);
    const parsed = parse(block.replace("# >>> sestina managed codex mcp\n", "").replace("# <<< sestina managed codex mcp\n", "")) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      mcp_servers: {
        sestina: {
          command: runtime.nodeExecutable,
          args: [runtime.serverEntry, "--project-root", runtime.projectRoot],
          cwd: runtime.projectRoot,
          enabled: true,
          required: false,
          enabled_tools: ["health", "get_research_context"],
          default_tools_approval_mode: "writes",
          startup_timeout_sec: 10,
          tool_timeout_sec: 5,
        },
      },
    });
  });

  it("preserves all bytes outside its block and removes only that block", () => {
    const original = "# user heading\n[mcp_servers.other]\ncommand = \"other\"\n# user tail";
    const connected = renderManagedCodexConfig(original, runtime);
    expect(connected).toMatchObject({ ok: true, value: { changed: true } });
    if (!connected.ok) return;
    expect(connected.value.content.startsWith(`${original}\n`)).toBe(true);
    const disconnected = removeManagedCodexConfig(connected.value.content);
    expect(disconnected).toEqual({ ok: true, value: { content: `${original}\n`, changed: true, deleteFile: false } });
    expect(parse(disconnected.ok ? disconnected.value.content : "")).toMatchObject({ mcp_servers: { other: { command: "other" } } });
  });

  it("is byte-idempotent and classifies managed drift", () => {
    const first = renderManagedCodexConfig("", runtime);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(renderManagedCodexConfig(first.value.content, runtime)).toEqual({
      ok: true,
      value: { content: first.value.content, changed: false, managedBlock: first.value.managedBlock },
    });
    const drifted = first.value.content.replace("tool_timeout_sec = 5", "tool_timeout_sec = 6");
    expect(inspectCodexConfig(drifted, runtime)).toEqual({ status: "drifted" });
  });

  it("fails closed for unmanaged ownership and malformed markers", () => {
    for (const source of [
      "[mcp_servers.sestina]\ncommand = \"foreign\"\n",
      "# >>> sestina managed codex mcp\n[mcp_servers.sestina]\ncommand = \"x\"\n",
      "# <<< sestina managed codex mcp\n",
      "# >>> sestina managed codex mcp\n# >>> sestina managed codex mcp\n# <<< sestina managed codex mcp\n",
      "# >>> sestina managed codex mcp\n# <<< sestina managed codex mcp\n# <<< sestina managed codex mcp\n",
    ]) {
      expect(renderManagedCodexConfig(source, runtime)).toMatchObject({ ok: false, error: { code: "state_conflict" } });
      expect(removeManagedCodexConfig(source)).toMatchObject({ ok: false, error: { code: "state_conflict" } });
    }
  });
});
