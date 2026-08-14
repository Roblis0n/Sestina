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

// ── Claude Code hook event names (the 31 events of the hooks reference) ───
export const CLAUDE_HOOK_EVENT_NAMES = [
  "SessionStart",
  "Setup",
  "InstructionsLoaded",
  "UserPromptSubmit",
  "UserPromptExpansion",
  "MessageDisplay",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
  "PermissionDenied",
  "Notification",
  "SubagentStart",
  "SubagentStop",
  "TaskCreated",
  "TaskCompleted",
  "Stop",
  "StopFailure",
  "TeammateIdle",
  "ConfigChange",
  "CwdChanged",
  "DirectoryAdded",
  "FileChanged",
  "WorktreeCreate",
  "WorktreeRemove",
  "PreCompact",
  "PostCompact",
  "SessionEnd",
  "Elicitation",
  "ElicitationResult",
] as const;
export type ClaudeHookEventName = (typeof CLAUDE_HOOK_EVENT_NAMES)[number];

// ── claude -p --output-format stream-json message types ───────────────────
export const CLAUDE_STREAM_TYPES = [
  "system",
  "assistant",
  "user",
  "result",
  "stream_event",
] as const;

const HOST: Host = "claude_code";

function str(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function fail(eventName: string): never {
  // The raw event name is host-controlled stdin and must never be echoed
  // into a message or details (content-leak / log-forging hygiene).
  throw new SestinaError(
    SestinaErrorCode.validation_failed,
    "unknown or malformed claude-code hook event",
    undefined,
    { host: "claude-code", receivedNameLength: eventName.length },
  );
}

function requireSession(hostSessionId: string | undefined, source: string): string {
  if (hostSessionId === undefined) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      `host session identity missing for ${source} — pass a sessionId hint for stream lines that carry none`,
      undefined,
      { host: "claude-code" },
    );
  }
  return hostSessionId;
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

function textLength(value: unknown): number {
  return valueLength(value);
}

function outputContent(value: unknown): ContentDescriptor | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const length = textLength(value);
  return {
    hasPrompt: false,
    hasFiles: false,
    hasOutput: true,
    outputLength: length,
    totalChars: length,
  };
}

function promptContent(prompt: string): ContentDescriptor {
  return {
    hasPrompt: true,
    promptLength: prompt.length,
    hasFiles: false,
    hasOutput: false,
    totalChars: prompt.length,
  };
}

/**
 * Normalize a size-checked Claude Code payload — hook stdin (snake_case
 * hook_event_name) or a claude stream-json line (type field).
 * Throws SestinaError(validation_failed) for unknown event names.
 */
export function normalizeClaudeEvent(
  limited: LimitedRawEvent,
  sessionHint: string | undefined,
): NormalizedHostFields {
  const raw = limited.raw;
  const hookName = str(raw, "hook_event_name");
  const type = str(raw, "type");
  // Governance authority (docs/12): only the hook path carries
  // hook_event_name, only the stream path carries a stream type. A payload
  // with BOTH is ambiguous about which path produced it, and dispatching it
  // as a hook event would let a stream line spoof hook-path authority
  // (sourceCapability "hooks" → governance decisions). Reject instead of
  // guessing. Hook-internal `type` descriptors (json-schema "object", rule
  // types like addRules) are not stream types and stay legitimate hook
  // payloads.
  if (
    hookName !== undefined &&
    type !== undefined &&
    (CLAUDE_STREAM_TYPES as readonly string[]).includes(type)
  ) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "ambiguous claude-code payload carries both hook_event_name and a stream type",
      undefined,
      { host: "claude_code", reason: "ambiguous_hook_and_stream_fields" },
    );
  }
  if (hookName !== undefined) {
    if (!(CLAUDE_HOOK_EVENT_NAMES as readonly string[]).includes(hookName)) {
      fail(hookName);
    }
    return normalizeClaudeHook(raw, hookName as ClaudeHookEventName, limited.bypass);
  }
  if (type !== undefined && (CLAUDE_STREAM_TYPES as readonly string[]).includes(type)) {
    return normalizeClaudeStream(raw, type, sessionHint, limited.bypass);
  }
  fail(type ?? "<missing hook_event_name/type>");
}

function lifecycle(
  eventType: NormalizedHostFields["eventType"],
  raw: Record<string, unknown>,
  bypass: boolean,
  discriminator: string,
  content?: ContentDescriptor,
  turnId?: string,
  hostVisibilityLevel?: NormalizedHostFields["hostVisibilityLevel"],
): NormalizedHostFields {
  return {
    eventType,
    host: HOST,
    nativeEventName: str(raw, "hook_event_name") ?? "?",
    phase: "lifecycle",
    hostSessionId: requireSession(str(raw, "session_id"), "claude hook"),
    turnId,
    occurredAt: nowUTC(),
    bypass,
    content,
    sourceCapability: "hooks",
    hostVisibilityLevel: hostVisibilityLevel ?? "governance_events",
    discriminator,
  };
}

function toolEvent(
  eventType: NormalizedHostFields["eventType"],
  phase: "pre" | "permission" | "post" | "failure" | "batch",
  raw: Record<string, unknown>,
  bypass: boolean,
  options: {
    toolCallId?: string;
    statusNote?: string;
    actionCandidate?: HostActionCandidate;
    content?: ContentDescriptor;
  },
): NormalizedHostFields {
  const toolName = str(raw, "tool_name");
  const candidate =
    options.actionCandidate ??
    (toolName === undefined
      ? undefined
      : {
          toolName,
          toolInput: raw.tool_input,
          cwd: str(raw, "cwd"),
          statusNote: options.statusNote,
        });
  return {
    eventType,
    host: HOST,
    nativeEventName: str(raw, "hook_event_name") ?? "?",
    phase,
    hostSessionId: requireSession(str(raw, "session_id"), "claude hook"),
    toolCallId: options.toolCallId,
    turnId: str(raw, "turn_id") ?? str(raw, "prompt_id"),
    occurredAt: nowUTC(),
    bypass,
    actionCandidate: candidate,
    content: options.content,
    sourceCapability: "hooks",
    hostVisibilityLevel: "tool_lifecycle",
  };
}

function normalizeClaudeHook(
  raw: Record<string, unknown>,
  name: ClaudeHookEventName,
  bypass: boolean,
): NormalizedHostFields {
  switch (name) {
    case "SessionStart":
      return lifecycle(
        "session_start",
        raw,
        bypass,
        `source=${str(raw, "source") ?? "?"}`,
      );
    case "Setup":
      return lifecycle(
        "session_start",
        raw,
        bypass,
        `trigger=${str(raw, "trigger") ?? "?"}`,
      );
    case "InstructionsLoaded": {
      const filePath = str(raw, "file_path");
      return lifecycle(
        "ui_action",
        raw,
        bypass,
        `load_reason=${str(raw, "load_reason") ?? "?"}|file=${fnv1aHex(filePath ?? "")}`,
        filePath === undefined
          ? undefined
          : { hasPrompt: false, hasFiles: true, fileCount: 1, hasOutput: false, totalChars: 0 },
      );
    }
    case "UserPromptSubmit":
      return lifecycle(
        "user_prompt",
        raw,
        bypass,
        "-",
        promptContent(str(raw, "prompt") ?? ""),
        str(raw, "prompt_id"),
      );
    case "UserPromptExpansion":
      return lifecycle(
        "user_prompt",
        raw,
        bypass,
        `command_name=${str(raw, "command_name") ?? "?"}`,
        promptContent(str(raw, "prompt") ?? ""),
        str(raw, "prompt_id"),
      );
    case "MessageDisplay": {
      const delta = str(raw, "delta") ?? "";
      return lifecycle(
        "chat_message",
        raw,
        bypass,
        `message_id=${str(raw, "message_id") ?? "?"}|index=${typeof raw.index === "number" ? raw.index.toString() : "?"}`,
        outputContent(delta),
        str(raw, "turn_id"),
        // Display-only batches: host visibility, not governance.
        "message_stream",
      );
    }
    case "PreToolUse":
      return toolEvent("pre_tool", "pre", raw, bypass, {
        toolCallId: str(raw, "tool_use_id"),
      });
    case "PermissionRequest":
      // Like Codex, Claude PermissionRequest has no tool_use_id.
      return toolEvent("permission_request", "permission", raw, bypass, {});
    case "PostToolUse":
      return toolEvent("post_tool", "post", raw, bypass, {
        toolCallId: str(raw, "tool_use_id"),
        content: outputContent(raw.tool_response),
      });
    case "PostToolUseFailure":
      return toolEvent("tool_failure", "failure", raw, bypass, {
        toolCallId: str(raw, "tool_use_id"),
        statusNote: "tool failed",
        content: outputContent(raw.error),
      });
    case "PostToolBatch": {
      const calls = raw.tool_calls;
      const files: unknown[] = [];
      let outputLength = 0;
      let hasOutput = false;
      if (Array.isArray(calls)) {
        for (const call of calls) {
          if (typeof call !== "object" || call === null) {
            continue;
          }
          const record = call as Record<string, unknown>;
          const input = record.tool_input;
          if (typeof input === "object" && input !== null) {
            const filePath = (input as Record<string, unknown>).file_path;
            if (typeof filePath === "string") {
              files.push(filePath);
            }
          }
          if (record.tool_response !== undefined) {
            hasOutput = true;
            outputLength += textLength(record.tool_response);
          }
        }
      }
      // A batch is one post_tool event with no single-tool action: multiple
      // tool calls per batch make a single ActionDescriptor misleading.
      return toolEvent("post_tool", "batch", raw, bypass, {
        content: {
          hasPrompt: false,
          hasFiles: files.length > 0,
          fileCount: files.length > 0 ? files.length : undefined,
          hasOutput,
          outputLength: hasOutput ? outputLength : undefined,
          totalChars: outputLength,
        },
      });
    }
    case "PermissionDenied":
      // A denied tool call is a terminal non-success outcome of a tool
      // invocation — recorded as tool_failure; the source event name stays
      // visible in the idempotency key's native name. The denial reason is
      // host text and may contain paths/classifier content, so only its
      // FNV-1a fingerprint is kept (never the raw string).
      return toolEvent("tool_failure", "failure", raw, bypass, {
        toolCallId: str(raw, "tool_use_id"),
        statusNote: `denied: ${fnv1aHex(str(raw, "reason") ?? "")}`,
      });
    case "Notification": {
      const message = str(raw, "message") ?? "";
      return lifecycle(
        "chat_message",
        raw,
        bypass,
        `type=${str(raw, "notification_type") ?? "?"}|message=${fnv1aHex(message)}`,
        outputContent(message),
      );
    }
    case "SubagentStart":
      return lifecycle(
        "session_start",
        raw,
        bypass,
        `agent_id=${str(raw, "agent_id") ?? "?"}`,
        undefined,
        str(raw, "turn_id") ?? str(raw, "prompt_id"),
      );
    case "SubagentStop":
      return lifecycle(
        "stop",
        raw,
        bypass,
        `agent_id=${str(raw, "agent_id") ?? "?"}`,
        outputContent(raw.last_assistant_message),
        str(raw, "turn_id") ?? str(raw, "prompt_id"),
      );
    case "TaskCreated":
      return lifecycle(
        "ui_action",
        raw,
        bypass,
        `task_id=${str(raw, "task_id") ?? "?"}`,
      );
    case "TaskCompleted":
      return lifecycle(
        "ui_action",
        raw,
        bypass,
        `task_id=${str(raw, "task_id") ?? "?"}`,
      );
    case "Stop":
      return lifecycle(
        "stop",
        raw,
        bypass,
        `stop_hook_active=${raw.stop_hook_active === true}`,
        outputContent(raw.last_assistant_message),
        str(raw, "turn_id") ?? str(raw, "prompt_id"),
      );
    case "StopFailure": {
      // An API error ending the turn is a host health signal, not a tool
      // failure — no action descriptor. The official error field is a closed
      // enum; anything outside it is host text and gets hashed instead.
      const KNOWN_STOP_FAILURES = new Set([
        "rate_limit",
        "overloaded",
        "authentication_failed",
        "oauth_org_not_allowed",
        "billing_error",
        "invalid_request",
        "model_not_found",
        "server_error",
        "max_output_tokens",
        "unknown",
      ]);
      const error = str(raw, "error") ?? "?";
      return lifecycle(
        "health_change",
        raw,
        bypass,
        `error=${KNOWN_STOP_FAILURES.has(error) ? error : fnv1aHex(error)}`,
        outputContent(raw.last_assistant_message),
      );
    }
    case "TeammateIdle":
      // A teammate finishing its turn — the same governance position as Stop.
      return lifecycle(
        "stop",
        raw,
        bypass,
        `teammate_name=${str(raw, "teammate_name") ?? "?"}`,
      );
    case "ConfigChange": {
      const filePath = str(raw, "file_path");
      return lifecycle(
        "ui_action",
        raw,
        bypass,
        `source=${str(raw, "source") ?? "?"}|file=${fnv1aHex(filePath ?? "")}`,
        filePath === undefined
          ? undefined
          : { hasPrompt: false, hasFiles: true, fileCount: 1, hasOutput: false, totalChars: 0 },
      );
    }
    case "CwdChanged":
      return lifecycle(
        "ui_action",
        raw,
        bypass,
        `old=${fnv1aHex(str(raw, "old_cwd") ?? "")}|new=${fnv1aHex(str(raw, "new_cwd") ?? "")}`,
      );
    case "DirectoryAdded":
      return lifecycle(
        "ui_action",
        raw,
        bypass,
        `source=${str(raw, "source") ?? "?"}|directory=${fnv1aHex(str(raw, "directory") ?? "")}`,
      );
    case "FileChanged": {
      const filePath = str(raw, "file_path");
      return lifecycle(
        "ui_action",
        raw,
        bypass,
        `event=${str(raw, "event") ?? "?"}|file=${fnv1aHex(filePath ?? "")}`,
        filePath === undefined
          ? undefined
          : { hasPrompt: false, hasFiles: true, fileCount: 1, hasOutput: false, totalChars: 0 },
      );
    }
    case "WorktreeCreate":
      return lifecycle(
        "ui_action",
        raw,
        bypass,
        `name=${str(raw, "name") ?? "?"}`,
      );
    case "WorktreeRemove": {
      const worktreePath = str(raw, "worktree_path");
      return lifecycle(
        "ui_action",
        raw,
        bypass,
        `path=${fnv1aHex(worktreePath ?? "")}`,
        worktreePath === undefined
          ? undefined
          : { hasPrompt: false, hasFiles: true, fileCount: 1, hasOutput: false, totalChars: 0 },
      );
    }
    case "PreCompact":
      return lifecycle(
        "pre_compact",
        raw,
        bypass,
        `trigger=${str(raw, "trigger") ?? "?"}`,
        undefined,
        str(raw, "turn_id") ?? str(raw, "prompt_id"),
      );
    case "PostCompact":
      return lifecycle(
        "post_compact",
        raw,
        bypass,
        `trigger=${str(raw, "trigger") ?? "?"}`,
        outputContent(raw.compact_summary),
        str(raw, "turn_id") ?? str(raw, "prompt_id"),
      );
    case "SessionEnd":
      return lifecycle(
        "session_end",
        raw,
        bypass,
        `reason=${str(raw, "reason") ?? "?"}`,
      );
    case "Elicitation":
      return lifecycle(
        "mcp_command",
        raw,
        bypass,
        `server=${str(raw, "mcp_server_name") ?? "?"}|mode=${str(raw, "mode") ?? "?"}`,
        outputContent(raw.message),
      );
    case "ElicitationResult":
      return lifecycle(
        "mcp_command",
        raw,
        bypass,
        `server=${str(raw, "mcp_server_name") ?? "?"}|action=${str(raw, "action") ?? "?"}|id=${str(raw, "elicitation_id") ?? "?"}`,
      );
  }
}

// ── claude stream-json lines ──────────────────────────────────────────────

function streamBase(
  type: string,
  raw: Record<string, unknown>,
  sessionHint: string | undefined,
  bypass: boolean,
): Omit<NormalizedHostFields, "eventType" | "nativeEventName" | "phase" | "discriminator"> & {
  eventType: "host_stream";
  nativeEventName: string;
} {
  return {
    eventType: "host_stream",
    host: HOST,
    nativeEventName: type,
    hostSessionId: requireSession(str(raw, "session_id") ?? sessionHint, `claude stream ${type}`),
    occurredAt: nowUTC(),
    bypass,
    sourceCapability: "stream",
    hostVisibilityLevel: "full_stream",
  };
}

function streamLifecycle(
  base: ReturnType<typeof streamBase>,
  raw: Record<string, unknown>,
  discriminator: string,
  content?: ContentDescriptor,
): NormalizedHostFields {
  return {
    ...base,
    phase: "stream",
    discriminator: str(raw, "uuid") ?? discriminator,
    content,
  };
}

function normalizeClaudeStream(
  raw: Record<string, unknown>,
  type: string,
  sessionHint: string | undefined,
  bypass: boolean,
): NormalizedHostFields {
  const base = streamBase(type, raw, sessionHint, bypass);
  switch (type) {
    case "system":
      return streamLifecycle(
        { ...base, nativeEventName: `system:${str(raw, "subtype") ?? "?"}` },
        raw,
        fnv1aHex(JSON.stringify(raw)),
      );
    case "result":
      return streamLifecycle(
        base,
        raw,
        fnv1aHex(JSON.stringify(raw)),
        outputContent(raw.result),
      );
    case "stream_event":
      return streamLifecycle(
        base,
        raw,
        fnv1aHex(JSON.stringify(raw)),
      );
    case "assistant":
      return normalizeAssistantLine(raw, base);
    case "user":
      return normalizeUserLine(raw, base);
    default:
      fail(type);
  }
}

interface StreamToolBlock {
  id?: string;
  name?: string;
  input?: unknown;
}

function messageBlocks(raw: Record<string, unknown>): unknown[] {
  const message = raw.message;
  if (typeof message !== "object" || message === null) {
    return [];
  }
  const content = (message as Record<string, unknown>).content;
  return Array.isArray(content) ? content : [];
}

function normalizeAssistantLine(
  raw: Record<string, unknown>,
  base: ReturnType<typeof streamBase>,
): NormalizedHostFields {
  const blocks = messageBlocks(raw);
  const toolUses: StreamToolBlock[] = [];
  let textChars = 0;
  for (const block of blocks) {
    if (typeof block !== "object" || block === null) {
      continue;
    }
    const record = block as Record<string, unknown>;
    if (record.type === "tool_use") {
      const id = typeof record.id === "string" ? record.id : undefined;
      const name = typeof record.name === "string" ? record.name : undefined;
      toolUses.push({ id, name, input: record.input });
    } else if (record.type === "text") {
      const text = record.text;
      if (typeof text === "string") {
        textChars += text.length;
      }
    }
  }
  const singleBlock = toolUses.length === 1 ? toolUses[0] : undefined;
  if (singleBlock?.name !== undefined) {
    // A single tool call in the message: pre-execution phase, correlatable
    // with the hook PreToolUse of the same tool_use_id.
    return {
      ...base,
      phase: "pre",
      toolCallId: singleBlock.id,
      actionCandidate: {
        toolName: singleBlock.name,
        toolInput: singleBlock.input,
        statusNote: undefined,
      },
      content: textChars > 0 ? textContent(textChars) : undefined,
    };
  }
  // No tool call or several parallel calls: no single action descriptor.
  return streamLifecycle(
    base,
    raw,
    fnv1aHex(JSON.stringify(raw)),
    textChars > 0 ? textContent(textChars) : undefined,
  );
}

function textContent(chars: number): ContentDescriptor {
  return {
    hasPrompt: false,
    hasFiles: false,
    hasOutput: true,
    outputLength: chars,
    totalChars: chars,
  };
}

function normalizeUserLine(
  raw: Record<string, unknown>,
  base: ReturnType<typeof streamBase>,
): NormalizedHostFields {
  const blocks = messageBlocks(raw);
  const toolResults: { toolUseId?: string; content?: unknown }[] = [];
  let outputChars = 0;
  for (const block of blocks) {
    if (typeof block !== "object" || block === null) {
      continue;
    }
    const record = block as Record<string, unknown>;
    if (record.type === "tool_result") {
      const toolUseId =
        typeof record.tool_use_id === "string" ? record.tool_use_id : undefined;
      toolResults.push({ toolUseId, content: record.content });
      outputChars += textLength(record.content);
    }
  }
  if (toolResults.length === 1) {
    // A single tool result: post-execution phase, correlatable with the
    // hook PostToolUse of the same tool_use_id. The result carries no tool
    // name, so no action descriptor is fabricated.
    return {
      ...base,
      phase: "post",
      toolCallId: toolResults[0]?.toolUseId,
      content: outputChars > 0 ? textContent(outputChars) : undefined,
    };
  }
  return streamLifecycle(
    base,
    raw,
    fnv1aHex(JSON.stringify(raw)),
    outputChars > 0 ? outputContent(outputChars) : undefined,
  );
}
