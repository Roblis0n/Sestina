import { describe, expect, it } from "vitest";
import {
  normalizeHostEvent,
  normalizeHostEventDetailed,
  RAW_EVENT_LIMITS,
  type NormalizeHostEventInput,
  type Result,
} from "../src/index.js";

function codexPreToolUse(overrides: Record<string, unknown> = {}): NormalizeHostEventInput {
  return {
    host: "codex",
    raw: {
      session_id: "codex-sess-0001",
      cwd: "C:\\Users\\alice\\projects\\demo",
      hook_event_name: "PreToolUse",
      model: "gpt-5.1-codex",
      permission_mode: "default",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      tool_use_id: "toolu_codex_01bash",
      turn_id: "turn-codex-0002",
      transcript_path: "C:\\Users\\alice\\.codex\\sessions\\codex-sess-0001.jsonl",
      ...overrides,
    },
  };
}

function expectError<T>(result: Result<T>): { code: string; details?: unknown; message: string } {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("unreachable");
  }
  return {
    code: result.error.code,
    details: result.error.details,
    message: result.error.message,
  };
}

describe("raw event limits", () => {
  it("rejects raw events larger than the byte cap with limit_exceeded", async () => {
    const big = codexPreToolUse({
      tool_input: { command: "x".repeat(RAW_EVENT_LIMITS.maxRawEventBytes + 16) },
    });
    const result = await normalizeHostEvent(big);
    const failure = expectError(result);
    expect(failure.code).toBe("limit_exceeded");
    const details = failure.details as { maxBytes?: number } | undefined;
    expect(details?.maxBytes).toBe(RAW_EVENT_LIMITS.maxRawEventBytes);
  });

  it("respects an explicit maxBytes override on the input", async () => {
    const ok = await normalizeHostEvent(
      codexPreToolUse({ tool_input: { command: "some command text" } }),
    );
    expect(ok.ok).toBe(true);

    const rejected = await normalizeHostEvent({
      ...codexPreToolUse({ tool_input: { command: "some command text" } }),
      maxBytes: 64,
    });
    expectError(rejected);
  });

  it("rejects non-object payloads with validation_failed", async () => {
    for (const raw of ["just a string", 42, [1, 2, 3], null]) {
      const result = await normalizeHostEvent({ host: "codex", raw });
      const failure = expectError(result);
      expect(failure.code).toBe("validation_failed");
    }
  });

  it("rejects payloads with neither a hook event name nor a stream type", async () => {
    const result = await normalizeHostEvent({
      host: "codex",
      raw: { session_id: "codex-sess-0001", cwd: "/tmp" },
    });
    expectError(result);
  });

  it("rejects unknown hook event names with the honest code and host details", async () => {
    const result = await normalizeHostEvent(
      codexPreToolUse({ hook_event_name: "NotARealCodexEvent" }),
    );
    const failure = expectError(result);
    expect(failure.code).toBe("validation_failed");
    // The raw host-controlled event name is never echoed into message or
    // details (content-leak hygiene) — only its length travels.
    const details = failure.details as { eventName?: unknown; receivedNameLength?: unknown } | undefined;
    expect(details?.eventName).toBeUndefined();
    expect(details?.receivedNameLength).toBe("NotARealCodexEvent".length);
    expect(failure.message).not.toContain("NotARealCodexEvent");
  });

  it("never echoes a hostile event name into the error message or details", async () => {
    const hostile = "/Users/alice/secret.txt";
    const result = await normalizeHostEvent(
      codexPreToolUse({ hook_event_name: hostile }),
    );
    const failure = expectError(result);
    expect(failure.message).not.toContain(hostile);
    expect(JSON.stringify(failure.details ?? {})).not.toContain(hostile);
  });

  it("rejects a Claude event on the codex path and a Codex stream on the Claude path", async () => {
    const claudeOnCodex = await normalizeHostEvent(
      codexPreToolUse({ hook_event_name: "MessageDisplay" }),
    );
    expectError(claudeOnCodex);

    // Codex hook event names are a subset of Claude's, so the cross-host
    // rejection on the claude path uses a codex-only stream line type.
    const codexStreamOnClaude = await normalizeHostEvent({
      host: "claude-code",
      raw: {
        session_id: "claude-sess-0001",
        type: "item.completed",
        item: { id: "toolu_x", type: "command_execution", status: "completed" },
      },
    });
    const failure = expectError(codexStreamOnClaude);
    expect(failure.code).toBe("validation_failed");
  });
});

describe("bypass detection (decided before deep parsing)", () => {
  it("marks bypassPermissions sessions as bypass on both hosts", async () => {
    const codex = await normalizeHostEvent(
      codexPreToolUse({ permission_mode: "bypassPermissions" }),
    );
    expect(codex.ok).toBe(true);
    if (codex.ok) {
      expect(codex.value.bypass).toBe(true);
    }
    const claude = await normalizeHostEvent({
      host: "claude-code",
      raw: {
        session_id: "claude-sess-0001",
        transcript_path: "/tmp/t.jsonl",
        cwd: "/Users/alice/projects/demo",
        permission_mode: "bypassPermissions",
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "npm test" },
        tool_use_id: "toolu_01",
      },
    });
    expect(claude.ok).toBe(true);
    if (claude.ok) {
      expect(claude.value.bypass).toBe(true);
    }
  });

  it("leaves other permission modes un-bypassed", async () => {
    // Codex's official enum (default|acceptEdits|plan|dontAsk|bypassPermissions).
    for (const mode of ["default", "acceptEdits", "plan", "dontAsk"]) {
      const result = await normalizeHostEvent(codexPreToolUse({ permission_mode: mode }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.bypass).toBe(false);
      }
    }
    // "auto" is a Claude-only mode and must be exercised on the Claude path.
    const claudeAuto = await normalizeHostEvent({
      host: "claude-code",
      raw: {
        session_id: "claude-sess-0001",
        transcript_path: "/tmp/t.jsonl",
        cwd: "/Users/alice/projects/demo",
        permission_mode: "auto",
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "npm test" },
        tool_use_id: "toolu_01",
      },
    });
    expect(claudeAuto.ok).toBe(true);
    if (claudeAuto.ok) {
      expect(claudeAuto.value.bypass).toBe(false);
    }
  });

  it("fails oversized events even in bypassPermissions mode (size gate is first)", async () => {
    const big = codexPreToolUse({
      permission_mode: "bypassPermissions",
      tool_input: { command: "x".repeat(RAW_EVENT_LIMITS.maxRawEventBytes + 16) },
    });
    const failure = expectError(await normalizeHostEvent(big));
    expect(failure.code).toBe("limit_exceeded");
  });
});

describe("summary field caps", () => {
  it("caps securitySummary at the configured length", async () => {
    const result = await normalizeHostEventDetailed(
      codexPreToolUse({ tool_input: { command: "npm test -- ".repeat(200) } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const summary = result.value.event.action?.securitySummary;
      expect(summary).toBeDefined();
      expect(summary?.length).toBeLessThanOrEqual(
        RAW_EVENT_LIMITS.maxSecuritySummaryChars,
      );
    }
  });

  it("caps resourceRefs at the configured count", async () => {
    const manyFiles: Record<string, string> = {};
    for (let i = 0; i < 40; i += 1) {
      manyFiles[`file_${i}`] = `C:\\Users\\alice\\projects\\demo\\src\\file_${i}.ts`;
    }
    const result = await normalizeHostEventDetailed({
      host: "claude-code",
      raw: {
        session_id: "claude-sess-0001",
        transcript_path: "/tmp/t.jsonl",
        cwd: "/Users/alice/projects/demo",
        permission_mode: "default",
        hook_event_name: "PreToolUse",
        tool_name: "mcp__fs__scan",
        tool_input: manyFiles,
        tool_use_id: "toolu_01many",
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.event.action?.resourceRefs.length).toBe(
        RAW_EVENT_LIMITS.maxResourceRefs,
      );
    }
  });
});
