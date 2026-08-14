import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  correlateHostAndHook,
  detectStreamGap,
  normalizeHostEventDetailed,
  type NormalizedHostEvent,
  type Result,
} from "../src/index.js";

const CODEX = resolve(import.meta.dirname, "../../../tests/fixtures/hooks/codex");
const CLAUDE = resolve(
  import.meta.dirname,
  "../../../tests/fixtures/hooks/claude-code",
);

function fixture(dir: string, name: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(resolve(dir, name), "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`fixture ${name} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function expectOk<T>(result: Result<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error("unreachable");
  }
  return result.value;
}

async function codexStream(name: string): Promise<NormalizedHostEvent> {
  return expectOk(
    await normalizeHostEventDetailed({
      host: "codex",
      raw: fixture(CODEX, name),
      sessionId: "codex-sess-0001",
    }),
  );
}

async function codexHook(name: string): Promise<NormalizedHostEvent> {
  return expectOk(
    await normalizeHostEventDetailed({ host: "codex", raw: fixture(CODEX, name) }),
  );
}

/**
 * Correlation merge rules (the spec).
 *
 * correlateHostAndHook merges the same tool call seen via the host stream AND
 * the hook path when ALL of these match:
 *   1. same host,
 *   2. same derived sessionId (same host session),
 *   3. host tool call ids present and equal (identity before phase),
 *   4. compatible phase: stream pre↔pre_tool, post↔post_tool,
 *      failure↔tool_failure,
 *   5. same action fingerprint (toolName|category|resourceRefs),
 *   6. |occurredAt difference| within maxTimeWindowMs (default 60s).
 * Otherwise both events are KEPT and marked possibleDuplicate with the first
 * failing reason. The hook event is the governance authority in the merged
 * record (its eventType and action win; the stream keeps the richer body).
 * A host sequence gap (previousStreamSequence + 1 < streamSequence) is ALWAYS
 * attached as an explicit StreamGap marker — never silently continued.
 */
describe("correlateHostAndHook", () => {
  it("merges the same Codex tool call seen via stream and hook", async () => {
    const stream = await codexStream("exec-stream-command-completed.json");
    const hook = await codexHook("post-tool-use-bash.json");
    const result = await correlateHostAndHook(stream, hook, {
      streamSequence: 5,
      previousStreamSequence: 4,
    });
    expect(result.kind).toBe("merged");
    if (result.kind === "merged") {
      expect(result.gap).toBeNull();
      // hook is the governance authority
      expect(result.merged.event.eventType).toBe("post_tool");
      expect(result.merged.event.action?.category).toBe("execute");
      expect(result.merged.event.sessionId).toBe(stream.event.sessionId);
      expect(result.merged.event.sessionId).toBe(hook.event.sessionId);
      expect(result.merged.event.idempotencyKey).toBe(hook.event.idempotencyKey);
      expect(result.merged.event.sourceCapability).toBe("hooks+stream");
    }
  });

  it("merged record keeps the strictest privacyClass of stream and hook", async () => {
    const stream = await codexStream("exec-stream-command-completed.json");
    const hook = await codexHook("post-tool-use-bash.json");
    const sensitiveHook: NormalizedHostEvent = {
      ...hook,
      event: { ...hook.event, privacyClass: "sensitive" },
    };
    const result = await correlateHostAndHook(stream, sensitiveHook);
    expect(result.kind).toBe("merged");
    if (result.kind === "merged") {
      // Merging is bookkeeping; it must never downgrade a stricter class.
      expect(result.merged.event.privacyClass).toBe("sensitive");
    }
  });

  it("keeps the stream privacyClass when it is the stricter side", async () => {
    const stream = await codexStream("exec-stream-command-completed.json");
    const restrictedStream: NormalizedHostEvent = {
      ...stream,
      event: { ...stream.event, privacyClass: "restricted" },
    };
    const hook = await codexHook("post-tool-use-bash.json");
    const result = await correlateHostAndHook(restrictedStream, hook);
    expect(result.kind).toBe("merged");
    if (result.kind === "merged") {
      expect(result.merged.event.privacyClass).toBe("restricted");
    }
  });

  it("keeps both and marks possible_duplicate on tool call id mismatch", async () => {
    const stream = await codexStream("exec-stream-command-completed.json");
    const hook = await codexHook("post-tool-use-failure-bash.json");
    const result = await correlateHostAndHook(stream, hook);
    expect(result.kind).toBe("possible_duplicate");
    if (result.kind === "possible_duplicate") {
      expect(result.reason).toBe("tool_call_id_mismatch");
    }
  });

  it("keeps both on phase mismatch (item.started vs PostToolUse)", async () => {
    const stream = await codexStream("exec-stream-command-started.json");
    const hook = await codexHook("post-tool-use-bash.json");
    const result = await correlateHostAndHook(stream, hook);
    expect(result.kind).toBe("possible_duplicate");
    if (result.kind === "possible_duplicate") {
      expect(result.reason).toBe("phase_mismatch");
    }
  });

  it("keeps both when the hook path has no tool call id (PermissionRequest)", async () => {
    const stream = await codexStream("exec-stream-command-started.json");
    const hook = await codexHook("permission-request-bash.json");
    const result = await correlateHostAndHook(stream, hook);
    expect(result.kind).toBe("possible_duplicate");
    if (result.kind === "possible_duplicate") {
      expect(result.reason).toBe("missing_tool_call_id");
    }
  });

  it("keeps both on action fingerprint mismatch", async () => {
    const stream = await codexStream("exec-stream-command-completed.json");
    const hook = await codexHook("post-tool-use-bash.json");
    // Same ids, same session — but a different resource fingerprint.
    const rewired: NormalizedHostEvent = {
      ...hook,
      event: {
        ...hook.event,
        action: hook.event.action
          ? { ...hook.event.action, resourceRefs: ["C:/users/alice/other/file.ts"] }
          : undefined,
      },
    };
    const result = await correlateHostAndHook(stream, rewired);
    expect(result.kind).toBe("possible_duplicate");
    if (result.kind === "possible_duplicate") {
      expect(result.reason).toBe("action_fingerprint_mismatch");
    }
  });

  it("keeps both when the time window is exceeded", async () => {
    const stream = await codexStream("exec-stream-command-completed.json");
    const hook = await codexHook("post-tool-use-bash.json");
    const shifted: NormalizedHostEvent = {
      ...hook,
      event: {
        ...hook.event,
        occurredAt: new Date(
          Date.parse(stream.event.occurredAt) + 10 * 60 * 1000,
        ).toISOString(),
      },
    };
    const result = await correlateHostAndHook(stream, shifted, {
      maxTimeWindowMs: 60_000,
    });
    expect(result.kind).toBe("possible_duplicate");
    if (result.kind === "possible_duplicate") {
      expect(result.reason).toBe("time_window");
    }
  });

  it("never merges across hosts", async () => {
    const codexStreamEvent = await codexStream("exec-stream-command-completed.json");
    const claudeHook = expectOk(
      await normalizeHostEventDetailed({
        host: "claude-code",
        raw: fixture(CLAUDE, "post-tool-use-bash.json"),
      }),
    );
    const result = await correlateHostAndHook(codexStreamEvent, claudeHook);
    expect(result.kind).toBe("possible_duplicate");
    if (result.kind === "possible_duplicate") {
      expect(result.reason).toBe("host_mismatch");
    }
  });

  it("keeps both on session mismatch (different host sessions)", async () => {
    const stream = expectOk(
      await normalizeHostEventDetailed({
        host: "codex",
        raw: fixture(CODEX, "exec-stream-command-completed.json"),
        sessionId: "codex-sess-9999",
      }),
    );
    const hook = await codexHook("post-tool-use-bash.json");
    const result = await correlateHostAndHook(stream, hook);
    expect(result.kind).toBe("possible_duplicate");
    if (result.kind === "possible_duplicate") {
      expect(result.reason).toBe("session_mismatch");
    }
  });

  it("keeps both on scope mismatch (one path bound to another project)", async () => {
    const stream = await codexStream("exec-stream-command-completed.json");
    const hook = expectOk(
      await normalizeHostEventDetailed({
        host: "codex",
        raw: fixture(CODEX, "post-tool-use-bash.json"),
        projectId: "01AN4Z07BY79KA1307SR9X4MV3",
      }),
    );
    const result = await correlateHostAndHook(stream, hook);
    expect(result.kind).toBe("possible_duplicate");
    if (result.kind === "possible_duplicate") {
      expect(result.reason).toBe("scope_mismatch");
    }
  });

  it("reports missing_action_fingerprint for a Claude tool_result with no tool name (documented asymmetry)", async () => {
    const stream = expectOk(
      await normalizeHostEventDetailed({
        host: "claude-code",
        raw: fixture(CLAUDE, "stream-json-user.json"),
      }),
    );
    const hook = expectOk(
      await normalizeHostEventDetailed({
        host: "claude-code",
        raw: fixture(CLAUDE, "post-tool-use-bash.json"),
      }),
    );
    const result = await correlateHostAndHook(stream, hook);
    expect(result.kind).toBe("possible_duplicate");
    if (result.kind === "possible_duplicate") {
      expect(result.reason).toBe("missing_action_fingerprint");
    }
  });

  it("attaches an explicit gap marker on sequence discontinuities", async () => {
    const stream = await codexStream("exec-stream-command-completed.json");
    const hook = await codexHook("post-tool-use-bash.json");
    const result = await correlateHostAndHook(stream, hook, {
      streamSequence: 7,
      previousStreamSequence: 4,
    });
    expect(result.kind).toBe("merged");
    if (result.kind === "merged") {
      expect(result.gap).toEqual({ from: 5, to: 6 });
    }
  });

  it("carries the gap marker even when the identity does not match", async () => {
    const stream = await codexStream("exec-stream-command-completed.json");
    const hook = await codexHook("post-tool-use-failure-bash.json");
    const result = await correlateHostAndHook(stream, hook, {
      streamSequence: 9,
      previousStreamSequence: 6,
    });
    expect(result.kind).toBe("possible_duplicate");
    if (result.kind === "possible_duplicate") {
      expect(result.gap).toEqual({ from: 7, to: 8 });
    }
  });
});

describe("detectStreamGap", () => {
  it("reports the skipped range", () => {
    expect(detectStreamGap(4, 7)).toEqual({ from: 5, to: 6 });
    expect(detectStreamGap(4, 5)).toBeNull();
    expect(detectStreamGap(4, 4)).toBeNull();
    expect(detectStreamGap(undefined, 7)).toBeNull();
    expect(detectStreamGap(4, undefined)).toBeNull();
    // going backwards is a discontinuity too; the regression window is
    // reported as [current, previous]
    expect(detectStreamGap(7, 4)).toEqual({ from: 4, to: 7 });
  });
});
