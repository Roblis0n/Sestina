import {
  SestinaError,
  SestinaErrorCode,
  nowUTC,
  type ContentDescriptor,
  type Host,
} from "@sestina/schema";
import { fnv1aHex } from "../idempotency.js";
import type { LimitedRawEvent } from "../limits.js";
import type { NormalizedHostFields } from "../normalize.js";
import type { HostActionCandidate } from "../resource-normalizer.js";

// ── Codex hook event names (the 11 official input schemas) ────────────────
//
// Wire traps (verified against official sources on 2026-08-14):
// - hook INPUT is snake_case with hook_event_name as a const; hook OUTPUT is
//   camelCase (hookSpecificOutput.hookEventName). This package normalizes
//   inputs; output writers must use the camelCase shape.
// - PermissionRequest input has NO tool_use_id (schema forbids it).
// - SessionEnd.reason is the const "other".
// - Hosted tools (WebSearch, image_generation, ...) emit NO tool hooks.
// - suppressOutput is a no-op on both hosts.
// - apply_patch is the canonical file-edit name (Write/Edit are matcher
//   aliases only); spawn_agent is the canonical subagent name (Agent alias).
export const CODEX_HOOK_EVENT_NAMES = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "Stop",
  "SubagentStart",
  "SubagentStop",
] as const;
export type CodexHookEventName = (typeof CODEX_HOOK_EVENT_NAMES)[number];

// ── codex exec --json stream event types (exec-events.rs) ─────────────────
export const CODEX_STREAM_TYPES = [
  "thread.started",
  "turn.started",
  "turn.completed",
  "turn.failed",
  "item.started",
  "item.updated",
  "item.completed",
  "error",
] as const;

/** Thread item kinds that carry tool semantics (classified into an action). */
const TOOL_ITEM_KINDS = new Set([
  "command_execution",
  "file_change",
  "mcp_tool_call",
  "collab_tool_call",
  "web_search",
]);

function str(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function fail(eventName: string): never {
  // The raw event name is host-controlled stdin and must never be echoed
  // into a message or details (content-leak / log-forging hygiene).
  throw new SestinaError(
    SestinaErrorCode.validation_failed,
    "unknown or malformed codex hook event",
    undefined,
    { host: "codex", receivedNameLength: eventName.length },
  );
}

function requireSession(hostSessionId: string | undefined, source: string): string {
  if (hostSessionId === undefined) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      `host session identity missing for ${source} — pass a sessionId hint for stream lines that carry none`,
      undefined,
      { host: "codex" },
    );
  }
  return hostSessionId;
}

const HOST: Host = "codex";

/**
 * Normalize a size-checked Codex payload — hook stdin (snake_case
 * hook_event_name) or a codex exec --json stream line (type field).
 * Throws SestinaError(validation_failed) for unknown event names.
 */
export function normalizeCodexEvent(
  limited: LimitedRawEvent,
  sessionHint: string | undefined,
): NormalizedHostFields {
  const raw = limited.raw;
  const hookName = str(raw, "hook_event_name");
  if (hookName !== undefined) {
    if (!(CODEX_HOOK_EVENT_NAMES as readonly string[]).includes(hookName)) {
      fail(hookName);
    }
    return normalizeCodexHook(raw, hookName as CodexHookEventName, limited.bypass);
  }
  const type = str(raw, "type");
  if (type !== undefined && (CODEX_STREAM_TYPES as readonly string[]).includes(type)) {
    return normalizeCodexStream(raw, type, sessionHint, limited.bypass);
  }
  fail(type ?? "<missing hook_event_name/type>");
}

function lifecycle(
  eventType: NormalizedHostFields["eventType"],
  nativeEventName: string,
  raw: Record<string, unknown>,
  bypass: boolean,
  discriminator: string,
  content?: ContentDescriptor,
  turnId?: string,
): NormalizedHostFields {
  return {
    eventType,
    host: HOST,
    nativeEventName,
    phase: "lifecycle",
    hostSessionId: requireSession(str(raw, "session_id"), nativeEventName),
    turnId,
    occurredAt: nowUTC(),
    bypass,
    content,
    sourceCapability: "hooks",
    hostVisibilityLevel: "governance_events",
    discriminator,
  };
}

function toolEvent(
  eventType: NormalizedHostFields["eventType"],
  nativeEventName: string,
  phase: "pre" | "permission" | "post" | "failure",
  raw: Record<string, unknown>,
  bypass: boolean,
  options: { toolCallId?: string; statusNote?: string; content?: ContentDescriptor },
): NormalizedHostFields {
  const toolName = str(raw, "tool_name");
  if (toolName === undefined) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      `codex ${nativeEventName} is missing tool_name`,
      undefined,
      { host: "codex", eventName: nativeEventName },
    );
  }
  const candidate: HostActionCandidate = {
    toolName,
    toolInput: raw.tool_input,
    cwd: str(raw, "cwd"),
    statusNote: options.statusNote,
  };
  return {
    eventType,
    host: HOST,
    nativeEventName,
    phase,
    hostSessionId: requireSession(str(raw, "session_id"), nativeEventName),
    toolCallId: options.toolCallId,
    turnId: str(raw, "turn_id"),
    occurredAt: nowUTC(),
    bypass,
    actionCandidate: candidate,
    content: options.content,
    sourceCapability: "hooks",
    hostVisibilityLevel: "tool_lifecycle",
  };
}

function normalizeCodexHook(
  raw: Record<string, unknown>,
  name: CodexHookEventName,
  bypass: boolean,
): NormalizedHostFields {
  switch (name) {
    case "SessionStart":
      return lifecycle(
        "session_start",
        name,
        raw,
        bypass,
        `source=${str(raw, "source") ?? "?"}`,
      );
    case "SessionEnd":
      // reason is the const "other" on the wire (session-end schema).
      return lifecycle(
        "session_end",
        name,
        raw,
        bypass,
        `reason=${str(raw, "reason") ?? "?"}`,
      );
    case "UserPromptSubmit": {
      const prompt = str(raw, "prompt") ?? "";
      return lifecycle(
        "user_prompt",
        name,
        raw,
        bypass,
        "-",
        {
          hasPrompt: true,
          promptLength: prompt.length,
          hasFiles: false,
          hasOutput: false,
          totalChars: prompt.length,
        },
        str(raw, "turn_id"),
      );
    }
    case "PreToolUse":
      return toolEvent("pre_tool", name, "pre", raw, bypass, {
        toolCallId: str(raw, "tool_use_id"),
      });
    case "PermissionRequest":
      // Per the official schema, PermissionRequest has NO tool_use_id.
      return toolEvent("permission_request", name, "permission", raw, bypass, {});
    case "PostToolUse": {
      const outcome = detectCodexToolOutcome(raw.tool_response);
      return toolEvent(
        outcome.failed ? "tool_failure" : "post_tool",
        name,
        outcome.failed ? "failure" : "post",
        raw,
        bypass,
        {
          toolCallId: str(raw, "tool_use_id"),
          statusNote: outcome.statusNote,
          content: outputContent(raw.tool_response),
        },
      );
    }
    case "PreCompact":
      return lifecycle(
        "pre_compact",
        name,
        raw,
        bypass,
        `trigger=${str(raw, "trigger") ?? "?"}`,
        undefined,
        str(raw, "turn_id"),
      );
    case "PostCompact":
      return lifecycle(
        "post_compact",
        name,
        raw,
        bypass,
        `trigger=${str(raw, "trigger") ?? "?"}`,
        undefined,
        str(raw, "turn_id"),
      );
    case "Stop":
      return lifecycle(
        "stop",
        name,
        raw,
        bypass,
        `stop_hook_active=${raw.stop_hook_active === true}`,
        outputContent(raw.last_assistant_message),
        str(raw, "turn_id"),
      );
    case "SubagentStart":
      return lifecycle(
        "session_start",
        name,
        raw,
        bypass,
        `agent_id=${str(raw, "agent_id") ?? "?"}`,
        undefined,
        str(raw, "turn_id"),
      );
    case "SubagentStop":
      return lifecycle(
        "stop",
        name,
        raw,
        bypass,
        `agent_id=${str(raw, "agent_id") ?? "?"}`,
        outputContent(raw.last_assistant_message),
        str(raw, "turn_id"),
      );
  }
}

/**
 * Structural success/failure detection for Codex PostToolUse — only the
 * response's own fields (exit_code, error) are inspected; never the output
 * text. Codex has no separate PostToolUseFailure event: failures surface
 * through PostToolUse with a non-zero exit code or an error field.
 */
function detectCodexToolOutcome(toolResponse: unknown): {
  failed: boolean;
  statusNote?: string;
} {
  if (typeof toolResponse !== "object" || toolResponse === null) {
    return { failed: false };
  }
  const response = toolResponse as Record<string, unknown>;
  const exitCode = response.exit_code;
  if (typeof exitCode === "number" && exitCode !== 0) {
    return { failed: true, statusNote: `exit_code ${exitCode}` };
  }
  if ("error" in response && response.error !== null) {
    return { failed: true, statusNote: "error reported" };
  }
  return { failed: false };
}

/** Serialized character count of a value — a count, never the content. */
function valueLength(value: unknown): number {
  if (typeof value === "string") {
    return value.length;
  }
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized.length : 0;
  } catch {
    return 0;
  }
}

/** Counts-only output descriptor — payload text is never stored. */
function outputContent(value: unknown): ContentDescriptor | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const length = valueLength(value);
  return {
    hasPrompt: false,
    hasFiles: false,
    hasOutput: true,
    outputLength: length,
    totalChars: length,
  };
}

// ── codex exec --json stream lines ────────────────────────────────────────

function streamBase(
  type: string,
  raw: Record<string, unknown>,
  sessionHint: string | undefined,
  bypass: boolean,
): Omit<NormalizedHostFields, "eventType" | "nativeEventName" | "phase" | "discriminator"> & {
  eventType: "host_stream";
  nativeEventName: string;
} {
  const threadId = str(raw, "thread_id");
  const hostSessionId =
    threadId ?? sessionHint;
  return {
    eventType: "host_stream",
    host: HOST,
    nativeEventName: type,
    hostSessionId: requireSession(hostSessionId, `codex stream ${type}`),
    occurredAt: nowUTC(),
    bypass,
    sourceCapability: "stream",
    hostVisibilityLevel: "full_stream",
  };
}

function normalizeCodexStream(
  raw: Record<string, unknown>,
  type: string,
  sessionHint: string | undefined,
  bypass: boolean,
): NormalizedHostFields {
  const base = streamBase(type, raw, sessionHint, bypass);
  switch (type) {
    case "thread.started":
      return {
        ...base,
        phase: "stream",
        discriminator: `thread_id=${str(raw, "thread_id") ?? "?"}`,
      };
    case "turn.started":
    case "turn.completed":
    case "turn.failed":
    case "error":
      return {
        ...base,
        phase: "stream",
        discriminator: fnv1aHex(JSON.stringify(raw)),
      };
    case "item.started":
    case "item.updated":
    case "item.completed":
      return normalizeCodexItem(raw, type, base);
    default:
      fail(type);
  }
}

function normalizeCodexItem(
  raw: Record<string, unknown>,
  eventType: string,
  base: ReturnType<typeof streamBase>,
): NormalizedHostFields {
  const itemValue = raw.item;
  if (typeof itemValue !== "object" || itemValue === null) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      `codex stream ${eventType} is missing its item payload`,
      undefined,
      { host: "codex", eventName: eventType },
    );
  }
  const item = itemValue as Record<string, unknown>;
  const itemId = str(item, "id");
  const itemType = str(item, "type") ?? "?";
  const status = str(item, "status");
  const statusNote = status === undefined ? undefined : `status ${status}`;

  if (!TOOL_ITEM_KINDS.has(itemType)) {
    // Non-tool items (agent_message, reasoning, the task-list kind, error): no action,
    // distinct keys via the item id.
    return {
      ...base,
      phase: "stream",
      discriminator: itemId ?? fnv1aHex(JSON.stringify(item)),
      nativeEventName: `${eventType}:${itemType}`,
    };
  }

  const actionCandidate = codexStreamActionCandidate(item, itemType, statusNote);
  const phase =
    eventType === "item.started"
      ? "pre"
      : eventType === "item.updated"
        ? "update"
        : status === "failed"
          ? "failure"
          : "post";

  return {
    ...base,
    nativeEventName: `${eventType}:${itemType}`,
    phase,
    toolCallId: itemId,
    actionCandidate,
    content: codexStreamItemContent(item, itemType),
  };
}

function codexStreamActionCandidate(
  item: Record<string, unknown>,
  itemType: string,
  statusNote: string | undefined,
): HostActionCandidate {
  switch (itemType) {
    case "command_execution":
      return {
        toolName: "Bash",
        toolInput: { command: str(item, "command") ?? "" },
        statusNote,
      };
    case "file_change":
      return {
        toolName: "apply_patch",
        toolInput: { changes: item.changes ?? [] },
        statusNote,
      };
    case "mcp_tool_call":
      return {
        toolName: `mcp__${str(item, "server") ?? "?"}__${str(item, "tool") ?? "?"}`,
        toolInput: item.arguments ?? {},
        statusNote,
      };
    case "collab_tool_call": {
      // The official CollabTool enum has four distinct tools
      // (spawn_agent | send_input | wait | close_agent) — each keeps its own
      // identity instead of being collapsed into spawn_agent.
      const collabTool = str(item, "tool") ?? "?";
      const known = new Set(["spawn_agent", "send_input", "wait", "close_agent"]);
      return {
        toolName: known.has(collabTool) ? collabTool : "collab_tool",
        toolInput: {},
        statusNote:
          statusNote === undefined
            ? `collab ${collabTool}`
            : `collab ${collabTool}, ${statusNote}`,
      };
    }
    case "web_search":
      return {
        toolName: "WebSearch",
        toolInput: { query: str(item, "query") ?? "" },
        statusNote,
      };
    default:
      return { toolName: itemType, toolInput: {}, statusNote };
  }
}

function codexStreamItemContent(
  item: Record<string, unknown>,
  itemType: string,
): ContentDescriptor | undefined {
  if (itemType === "file_change") {
    const changes = item.changes;
    const fileCount = Array.isArray(changes) ? changes.length : 0;
    return fileCount > 0
      ? {
          hasPrompt: false,
          hasFiles: true,
          fileCount,
          hasOutput: false,
          totalChars: 0,
        }
      : undefined;
  }
  if (itemType === "command_execution") {
    return outputContent(item.aggregated_output);
  }
  if (itemType === "mcp_tool_call") {
    return outputContent(item.result);
  }
  return undefined;
}
