import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  normalizeHostEvent,
  normalizeHostEventDetailed,
  type NormalizeHostEventInput,
  type Result,
} from "../src/index.js";

const FIXTURES = resolve(import.meta.dirname, "../../../tests/fixtures/hooks/codex");
const CLAUDE_FIXTURES = resolve(
  import.meta.dirname,
  "../../../tests/fixtures/hooks/claude-code",
);

function loadFixture(dir: string, name: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(resolve(dir, name), "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`fixture ${name} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function codexFixture(name: string): Record<string, unknown> {
  return loadFixture(FIXTURES, name);
}

function codexInput(
  name: string,
  extra: Partial<NormalizeHostEventInput> = {},
): NormalizeHostEventInput {
  return { host: "codex", raw: codexFixture(name), ...extra };
}

function expectOk<T>(result: Result<T>): T {
  expect(result.ok, `expected ok, got: ${JSON.stringify(!result.ok ? result.error.toJSON() : null)}`).toBe(true);
  if (!result.ok) {
    throw new Error("unreachable");
  }
  return result.value;
}

/**
 * ── Codex hook event → StandardEvent.eventType mapping (the spec) ──
 * SessionStart→session_start, SessionEnd→session_end, UserPromptSubmit→user_prompt,
 * PreToolUse→pre_tool, PermissionRequest→permission_request,
 * PostToolUse→post_tool (exit 0) | tool_failure (exit != 0 or error field),
 * PreCompact→pre_compact, PostCompact→post_compact, Stop→stop,
 * SubagentStart→session_start, SubagentStop→stop.
 * All codex exec --json lines → host_stream.
 */
describe("codex hook fixtures", () => {
  const HOOK_MATRIX: readonly {
    fixture: string;
    eventType: string;
    category?: string;
    reversible?: boolean;
    external?: boolean;
    refs?: string[];
  }[] = [
    { fixture: "session-start.json", eventType: "session_start" },
    { fixture: "session-end.json", eventType: "session_end" },
    { fixture: "user-prompt-submit.json", eventType: "user_prompt" },
    {
      fixture: "pre-tool-use-bash.json",
      eventType: "pre_tool",
      category: "execute",
      reversible: false,
      external: false,
      refs: [],
    },
    {
      fixture: "pre-tool-use-apply-patch.json",
      eventType: "pre_tool",
      category: "write",
      reversible: true,
      external: false,
      refs: ["C:/users/alice/projects/demo/src/app.ts"],
    },
    {
      fixture: "permission-request-bash.json",
      eventType: "permission_request",
      category: "execute",
      reversible: false,
      external: false,
    },
    {
      fixture: "post-tool-use-bash.json",
      eventType: "post_tool",
      category: "execute",
      reversible: false,
      external: false,
    },
    {
      fixture: "post-tool-use-failure-bash.json",
      eventType: "tool_failure",
      category: "execute",
      reversible: false,
      external: false,
    },
    { fixture: "pre-compact.json", eventType: "pre_compact" },
    { fixture: "post-compact.json", eventType: "post_compact" },
    { fixture: "stop.json", eventType: "stop" },
    { fixture: "subagent-start.json", eventType: "session_start" },
    { fixture: "subagent-stop.json", eventType: "stop" },
  ];

  for (const row of HOOK_MATRIX) {
    it(`normalizes Codex ${row.fixture} to ${row.eventType}`, async () => {
      const result = await normalizeHostEvent(codexInput(row.fixture));
      const event = expectOk(result);
      expect(event.host).toBe("codex");
      expect(event.eventType).toBe(row.eventType);
      expect(event.bypass).toBe(false);
      expect(event.privacyClass).toBe("internal");
      expect(event.rawPayloadHash).toMatch(/^[a-f0-9]{64}$/);
      expect(event.sourceCapability).toBe("hooks");
      if (row.category === undefined) {
        expect(event.action).toBeUndefined();
      } else {
        expect(event.action?.category).toBe(row.category);
        expect(event.action?.reversible).toBe(row.reversible);
        expect(event.action?.external).toBe(row.external);
        expect(event.action?.toolName).toBeDefined();
        if (row.refs !== undefined) {
          expect(event.action?.resourceRefs).toEqual(row.refs);
        }
      }
    });
  }

  it("carries prompt content counts for Codex UserPromptSubmit", async () => {
    const event = expectOk(
      await normalizeHostEvent(codexInput("user-prompt-submit.json")),
    );
    expect(event.content?.hasPrompt).toBe(true);
    expect(event.content?.promptLength).toBe(34);
    expect(event.content?.hasFiles).toBe(false);
    expect(event.content?.totalChars).toBe(34);
  });

  it("carries assistant output counts for Codex Stop", async () => {
    const event = expectOk(await normalizeHostEvent(codexInput("stop.json")));
    expect(event.content?.hasOutput).toBe(true);
    expect(event.content?.outputLength).toBe("All tasks completed.".length);
  });

  it("detects Codex PostToolUse failure through exit_code without content sniffing", async () => {
    const failed = expectOk(
      await normalizeHostEvent(codexInput("post-tool-use-failure-bash.json")),
    );
    expect(failed.eventType).toBe("tool_failure");
    // exit code 0 stays post_tool; only structural signals are inspected
    const ok = expectOk(
      await normalizeHostEvent(codexInput("post-tool-use-bash.json")),
    );
    expect(ok.eventType).toBe("post_tool");
  });
});

describe("codex exec --json stream lines", () => {
  it("normalizes thread.started to host_stream", async () => {
    const event = expectOk(
      await normalizeHostEvent(
        codexInput("exec-stream-thread-started.json", { sessionId: "codex-sess-0001" }),
      ),
    );
    expect(event.eventType).toBe("host_stream");
    expect(event.action).toBeUndefined();
    expect(event.sourceCapability).toBe("stream");
    expect(event.hostVisibilityLevel).toBe("full_stream");
  });

  const STREAM_MATRIX: readonly {
    fixture: string;
    category?: string;
    toolName?: string;
    reversible?: boolean;
    external?: boolean;
    refs?: string[];
    statusNote?: string;
  }[] = [
    {
      fixture: "exec-stream-command-started.json",
      category: "execute",
      toolName: "Bash",
      reversible: false,
      external: false,
      refs: [],
    },
    {
      fixture: "exec-stream-command-completed.json",
      category: "execute",
      toolName: "Bash",
      reversible: false,
      external: false,
      refs: [],
    },
    {
      fixture: "exec-stream-command-failed.json",
      category: "execute",
      toolName: "Bash",
      reversible: false,
      external: false,
      statusNote: "failed",
    },
    {
      fixture: "exec-stream-file-change.json",
      category: "write",
      toolName: "apply_patch",
      reversible: true,
      external: false,
      refs: ["C:/users/alice/projects/demo/src/app.ts"],
    },
    {
      fixture: "exec-stream-mcp.json",
      category: "read",
      toolName: "mcp__filesystem__read_file",
      reversible: false,
      external: false,
      refs: ["C:/users/alice/projects/demo/readme.md"],
    },
    {
      fixture: "exec-stream-web-search.json",
      category: "network",
      toolName: "WebSearch",
      reversible: true,
      external: true,
    },
  ];

  for (const row of STREAM_MATRIX) {
    it(`normalizes ${row.fixture} with a classified action`, async () => {
      const result = await normalizeHostEventDetailed(
        codexInput(row.fixture, { sessionId: "codex-sess-0001" }),
      );
      const detailed = expectOk(result);
      expect(detailed.event.eventType).toBe("host_stream");
      expect(detailed.event.sourceCapability).toBe("stream");
      expect(detailed.event.action?.category).toBe(row.category);
      expect(detailed.event.action?.toolName).toBe(row.toolName);
      expect(detailed.event.action?.reversible).toBe(row.reversible);
      expect(detailed.event.action?.external).toBe(row.external);
      if (row.refs !== undefined) {
        expect(detailed.event.action?.resourceRefs).toEqual(row.refs);
      }
      if (row.statusNote !== undefined) {
        expect(detailed.event.action?.securitySummary).toContain(row.statusNote);
      }
    });
  }

  it("keeps the item id as the host tool call id on stream events", async () => {
    const detailed = expectOk(
      await normalizeHostEventDetailed(
        codexInput("exec-stream-command-started.json", {
          sessionId: "codex-sess-0001",
        }),
      ),
    );
    expect(detailed.hostToolCallId).toBe("toolu_codex_01bash");
  });

  it("keeps each collab tool's own identity instead of collapsing into spawn_agent", async () => {
    const wait = expectOk(
      await normalizeHostEventDetailed(
        codexInput("exec-stream-collab-wait.json", { sessionId: "codex-sess-0001" }),
      ),
    );
    expect(wait.event.action?.toolName).toBe("wait");
    expect(wait.event.action?.securitySummary).toContain("collab wait");
    // The canonical spawn identity still classifies as execute.
    const spawn = expectOk(
      await normalizeHostEventDetailed({
        host: "codex",
        sessionId: "codex-sess-0001",
        raw: {
          type: "item.completed",
          item: {
            id: "item_col_02",
            type: "collab_tool_call",
            tool: "spawn_agent",
            status: "completed",
          },
        },
      }),
    );
    expect(spawn.event.action?.toolName).toBe("spawn_agent");
    expect(spawn.event.action?.category).toBe("execute");
  });

  it("classifies a Codex stream mcp deploy item as external", async () => {
    const detailed = expectOk(
      await normalizeHostEventDetailed({
        host: "codex",
        sessionId: "codex-sess-0001",
        raw: {
          type: "item.completed",
          item: {
            id: "item_mcp_09",
            type: "mcp_tool_call",
            server: "vercel",
            tool: "deploy",
            status: "completed",
          },
        },
      }),
    );
    expect(detailed.event.action?.toolName).toBe("mcp__vercel__deploy");
    expect(detailed.event.action?.external).toBe(true);
  });

  it("never treats a Codex collab tool call as a collaboration_* event", async () => {
    const detailed = expectOk(
      await normalizeHostEventDetailed({
        host: "codex",
        sessionId: "codex-sess-0001",
        raw: {
          type: "item.completed",
          item: {
            id: "item_col_05",
            type: "collab_tool_call",
            tool: "send_input",
            status: "completed",
          },
        },
      }),
    );
    expect(detailed.event.eventType).toBe("host_stream");
    expect(detailed.event.action?.toolName).toBe("send_input");
    expect(detailed.event.action?.external).toBe(false);
  });

  it("normalizes a stream error line without crashing", async () => {
    const event = expectOk(
      await normalizeHostEvent(
        codexInput("exec-stream-error.json", { sessionId: "codex-sess-0001" }),
      ),
    );
    expect(event.eventType).toBe("host_stream");
    expect(event.action).toBeUndefined();
  });

  it("requires a host session identity for stream lines that carry none", async () => {
    const result = await normalizeHostEvent(
      codexInput("exec-stream-command-started.json"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation_failed");
    }
  });
});

describe("dual-host equivalence (docs/22 Step 1)", () => {
  it("normalizes equivalent Codex and Claude writes to the same action semantics", async () => {
    const codex = await normalizeHostEvent(
      codexInput("pre-tool-use-apply-patch.json"),
    );
    const claude = await normalizeHostEvent({
      host: "claude-code",
      raw: loadFixture(CLAUDE_FIXTURES, "pre-tool-use-write.json"),
    });

    const codexWrite = expectOk(codex);
    const claudeWrite = expectOk(claude);
    expect(codexWrite.action?.category).toBe("write");
    expect(claudeWrite.action?.category).toBe("write");
    expect(codexWrite.action?.reversible).toBe(claudeWrite.action?.reversible);
    expect(codexWrite.action?.external).toBe(claudeWrite.action?.external);
    // Both hosts express the same target file; the normalizer unifies
    // Windows separators/case so the resource refs match exactly.
    expect(codexWrite.action?.resourceRefs).toEqual(
      claudeWrite.action?.resourceRefs,
    );
    expect(codexWrite.action?.resourceRefs).toEqual([
      "C:/users/alice/projects/demo/src/app.ts",
    ]);
    // Keys intentionally differ across hosts; only action SEMANTICS match.
    expect(codexWrite.idempotencyKey).not.toBe(claudeWrite.idempotencyKey);
  });

  it("normalizes equivalent Codex and Claude shell calls to execute semantics", async () => {
    const codex = expectOk(
      await normalizeHostEvent(codexInput("pre-tool-use-bash.json")),
    );
    const claude = expectOk(
      await normalizeHostEvent({
        host: "claude-code",
        raw: loadFixture(CLAUDE_FIXTURES, "pre-tool-use-bash.json"),
      }),
    );
    expect(codex.action?.category).toBe("execute");
    expect(claude.action?.category).toBe("execute");
    expect(codex.action?.reversible).toBe(false);
    expect(claude.action?.reversible).toBe(false);
  });
});
