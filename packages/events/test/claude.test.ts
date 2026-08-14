import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  normalizeHostEvent,
  normalizeHostEventDetailed,
  type NormalizeHostEventInput,
  type Result,
} from "../src/index.js";

const FIXTURES = resolve(
  import.meta.dirname,
  "../../../tests/fixtures/hooks/claude-code",
);

function loadFixture(name: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(resolve(FIXTURES, name), "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`fixture ${name} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function claudeInput(
  name: string,
  extra: Partial<NormalizeHostEventInput> = {},
): NormalizeHostEventInput {
  return { host: "claude-code", raw: loadFixture(name), ...extra };
}

function expectOk<T>(result: Result<T>): T {
  expect(
    result.ok,
    `expected ok, got: ${JSON.stringify(!result.ok ? result.error.toJSON() : null)}`,
  ).toBe(true);
  if (!result.ok) {
    throw new Error("unreachable");
  }
  return result.value;
}

/**
 * ── Claude Code hook event → StandardEvent.eventType mapping (the spec) ──
 * SessionStart→session_start, Setup→session_start, InstructionsLoaded→ui_action,
 * UserPromptSubmit→user_prompt, UserPromptExpansion→user_prompt,
 * MessageDisplay→chat_message, PreToolUse→pre_tool,
 * PermissionRequest→permission_request, PostToolUse→post_tool,
 * PostToolUseFailure→tool_failure, PostToolBatch→post_tool,
 * PermissionDenied→tool_failure (terminal non-success of a tool invocation),
 * Notification→chat_message, SubagentStart→session_start, SubagentStop→stop,
 * TaskCreated→ui_action, TaskCompleted→ui_action, Stop→stop,
 * StopFailure→health_change (API error, not a tool failure),
 * TeammateIdle→stop (turn finishing for a teammate),
 * ConfigChange→ui_action, CwdChanged→ui_action, DirectoryAdded→ui_action,
 * FileChanged→ui_action, WorktreeCreate→ui_action, WorktreeRemove→ui_action,
 * PreCompact→pre_compact, PostCompact→post_compact, SessionEnd→session_end,
 * Elicitation→mcp_command, ElicitationResult→mcp_command.
 * All claude stream-json lines (system/assistant/user/result/stream_event)
 * → host_stream.
 *
 * Events with no action semantics normalize with action === undefined.
 */
describe("claude-code hook fixtures", () => {
  const HOOK_MATRIX: readonly {
    fixture: string;
    eventType: string;
    category?: string;
    reversible?: boolean;
    external?: boolean;
    refs?: string[];
  }[] = [
    { fixture: "session-start.json", eventType: "session_start" },
    { fixture: "setup.json", eventType: "session_start" },
    { fixture: "instructions-loaded.json", eventType: "ui_action" },
    { fixture: "user-prompt-submit.json", eventType: "user_prompt" },
    { fixture: "user-prompt-expansion.json", eventType: "user_prompt" },
    { fixture: "message-display.json", eventType: "chat_message" },
    {
      fixture: "pre-tool-use-bash.json",
      eventType: "pre_tool",
      category: "execute",
      reversible: false,
      external: false,
      refs: [],
    },
    {
      fixture: "pre-tool-use-write.json",
      eventType: "pre_tool",
      category: "write",
      reversible: true,
      external: false,
      refs: ["C:/users/alice/projects/demo/src/app.ts"],
    },
    {
      fixture: "pre-tool-use-edit.json",
      eventType: "pre_tool",
      category: "write",
      reversible: true,
      external: false,
      refs: ["/Users/alice/projects/demo/src/app.ts"],
    },
    {
      fixture: "pre-tool-use-web-fetch.json",
      eventType: "pre_tool",
      category: "network",
      reversible: true,
      external: true,
      refs: [],
    },
    {
      fixture: "permission-request-bash.json",
      eventType: "permission_request",
      category: "execute",
      reversible: false,
      external: false,
    },
    {
      fixture: "post-tool-use-write.json",
      eventType: "post_tool",
      category: "write",
      reversible: true,
      external: false,
      refs: ["C:/users/alice/projects/demo/src/app.ts"],
    },
    {
      fixture: "post-tool-use-bash.json",
      eventType: "post_tool",
      category: "execute",
      reversible: false,
      external: false,
    },
    {
      fixture: "post-tool-use-failure.json",
      eventType: "tool_failure",
      category: "execute",
      reversible: false,
      external: false,
    },
    { fixture: "post-tool-batch.json", eventType: "post_tool" },
    {
      fixture: "permission-denied.json",
      eventType: "tool_failure",
      category: "execute",
      reversible: false,
      external: false,
    },
    { fixture: "notification.json", eventType: "chat_message" },
    { fixture: "subagent-start.json", eventType: "session_start" },
    { fixture: "subagent-stop.json", eventType: "stop" },
    { fixture: "task-created.json", eventType: "ui_action" },
    { fixture: "task-completed.json", eventType: "ui_action" },
    { fixture: "stop.json", eventType: "stop" },
    { fixture: "stop-failure.json", eventType: "health_change" },
    { fixture: "teammate-idle.json", eventType: "stop" },
    { fixture: "config-change.json", eventType: "ui_action" },
    { fixture: "cwd-changed.json", eventType: "ui_action" },
    { fixture: "directory-added.json", eventType: "ui_action" },
    { fixture: "file-changed.json", eventType: "ui_action" },
    { fixture: "worktree-create.json", eventType: "ui_action" },
    { fixture: "worktree-remove.json", eventType: "ui_action" },
    { fixture: "pre-compact.json", eventType: "pre_compact" },
    { fixture: "post-compact.json", eventType: "post_compact" },
    { fixture: "session-end.json", eventType: "session_end" },
    { fixture: "elicitation.json", eventType: "mcp_command" },
    { fixture: "elicitation-result.json", eventType: "mcp_command" },
  ];

  for (const row of HOOK_MATRIX) {
    it(`normalizes Claude ${row.fixture} to ${row.eventType}`, async () => {
      const result = await normalizeHostEvent(claudeInput(row.fixture));
      const event = expectOk(result);
      expect(event.host).toBe("claude_code");
      expect(event.eventType).toBe(row.eventType);
      expect(event.bypass).toBe(false);
      expect(event.privacyClass).toBe("internal");
      expect(event.sourceCapability).toBe("hooks");
      if (row.category === undefined) {
        expect(event.action).toBeUndefined();
      } else {
        expect(event.action?.category).toBe(row.category);
        expect(event.action?.reversible).toBe(row.reversible);
        expect(event.action?.external).toBe(row.external);
        if (row.refs !== undefined) {
          expect(event.action?.resourceRefs).toEqual(row.refs);
        }
      }
    });
  }

  it("keeps MessageDisplay under message_stream visibility", async () => {
    const event = expectOk(
      await normalizeHostEvent(claudeInput("message-display.json")),
    );
    expect(event.hostVisibilityLevel).toBe("message_stream");
    expect(event.content?.hasOutput).toBe(true);
    expect(event.content?.outputLength).toBe("Here is the plan:\n".length);
  });

  it("records the batch as one post_tool event without a single-tool action", async () => {
    const event = expectOk(
      await normalizeHostEvent(claudeInput("post-tool-batch.json")),
    );
    expect(event.action).toBeUndefined();
    expect(event.content?.hasFiles).toBe(true);
    expect(event.content?.fileCount).toBe(2);
    expect(event.content?.hasOutput).toBe(true);
  });

  it("keeps tool lifecycle hooks under tool_lifecycle visibility", async () => {
    const event = expectOk(
      await normalizeHostEvent(claudeInput("pre-tool-use-bash.json")),
    );
    expect(event.hostVisibilityLevel).toBe("tool_lifecycle");
  });

  it("maps Elicitation events to mcp_command without a tool action", async () => {
    const event = expectOk(
      await normalizeHostEvent(claudeInput("elicitation.json")),
    );
    expect(event.action).toBeUndefined();
    expect(event.content?.hasOutput).toBe(true);
  });
});

describe("claude stream-json lines", () => {
  it("normalizes system/init to host_stream", async () => {
    const event = expectOk(
      await normalizeHostEvent(claudeInput("stream-json-system-init.json")),
    );
    expect(event.eventType).toBe("host_stream");
    expect(event.action).toBeUndefined();
    expect(event.sourceCapability).toBe("stream");
    expect(event.hostVisibilityLevel).toBe("full_stream");
  });

  it("classifies a single tool_use block in an assistant message", async () => {
    const detailed = expectOk(
      await normalizeHostEventDetailed(claudeInput("stream-json-assistant.json")),
    );
    expect(detailed.event.eventType).toBe("host_stream");
    expect(detailed.event.action?.category).toBe("execute");
    expect(detailed.event.action?.toolName).toBe("Bash");
    expect(detailed.hostToolCallId).toBe("toolu_claude_01bash");
  });

  it("keeps tool_result user messages without fabricating an action", async () => {
    const detailed = expectOk(
      await normalizeHostEventDetailed(claudeInput("stream-json-user.json")),
    );
    expect(detailed.event.eventType).toBe("host_stream");
    expect(detailed.event.action).toBeUndefined();
    expect(detailed.hostToolCallId).toBe("toolu_claude_01bash");
    expect(detailed.event.content?.hasOutput).toBe(true);
  });

  it("normalizes the final result line to host_stream", async () => {
    const event = expectOk(
      await normalizeHostEvent(claudeInput("stream-json-result.json")),
    );
    expect(event.eventType).toBe("host_stream");
    expect(event.action).toBeUndefined();
  });
});

describe("classifier rules (MCP tokens, Monitor, anchors)", () => {
  function claudePreToolUse(toolName: string, toolInput: unknown): NormalizeHostEventInput {
    return {
      host: "claude-code",
      raw: {
        session_id: "claude-sess-0001",
        transcript_path: "/tmp/t.jsonl",
        cwd: "/Users/alice/projects/demo",
        permission_mode: "default",
        hook_event_name: "PreToolUse",
        tool_name: toolName,
        tool_input: toolInput,
        tool_use_id: "toolu_claude_class",
      },
    };
  }

  it("classifies mcp__slack__post_message as publish (not write)", async () => {
    const event = expectOk(
      await normalizeHostEvent(claudePreToolUse("mcp__slack__post_message", { channel: "dev" })),
    );
    expect(event.action?.category).toBe("publish");
    expect(event.action?.external).toBe(true);
  });

  it("does not classify mcp__db__forget_row as read via a 'get' substring", async () => {
    const event = expectOk(
      await normalizeHostEvent(claudePreToolUse("mcp__db__forget_row", { id: 1 })),
    );
    expect(event.action?.category).toBe("unknown");
    expect(event.action?.toolName).toBe("mcp__db__forget_row");
  });

  it("classifies mcp__filesystem__write_file as write and mcp__api__send_request as publish", async () => {
    const write = expectOk(
      await normalizeHostEvent(claudePreToolUse("mcp__filesystem__write_file", { path: "/tmp/a" })),
    );
    expect(write.action?.category).toBe("write");
    const send = expectOk(
      await normalizeHostEvent(claudePreToolUse("mcp__api__send_request", { url: "https://x" })),
    );
    expect(send.action?.category).toBe("publish");
    expect(send.action?.external).toBe(true);
  });

  it("classifies the Monitor tool as a read observation", async () => {
    const event = expectOk(
      await normalizeHostEvent(claudePreToolUse("Monitor", { task_id: "t1" })),
    );
    expect(event.action?.category).toBe("read");
    expect(event.action?.reversible).toBe(true);
    expect(event.action?.external).toBe(false);
  });
});
