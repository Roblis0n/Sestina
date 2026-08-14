import type { ActionCategory, ActionDescriptor, Host } from "@sestina/schema";
import { RAW_EVENT_LIMITS } from "./limits.js";
import {
  normalizeResources,
  type HostActionCandidate,
  type NormalizedActionCandidate,
} from "./resource-normalizer.js";

// ── Action classification tables (the spec; mirrored in the tests) ────────
//
// Categories are the fixed ActionCategorySchema set:
// read|write|delete|execute|network|publish|deploy|message|unknown.
//
// `reversible` reflects whether the host supports an automatic undo of the
// action:
//   - Codex apply_patch and Claude Write/Edit/NotebookEdit are reversible —
//     the host retains the prior content (Edit's old_string, git-tracked file
//     state), so an automatic undo exists.
//   - Reads are trivially reversible (nothing to undo); message/network
//     tools have no local mutation, so true as well.
//   - Bash/PowerShell and subagent spawning are NOT reversible — their side
//     effects (file changes, processes) cannot be automatically undone.
//   - MCP tools are unknown-by-construction: always false (never claim an
//     undo capability for a third-party tool).
//
// `external` marks whether the action's effects leave the local environment:
//   - Network tools (WebFetch/WebSearch) are external.
//   - Bash/PowerShell are classified as NOT external at the tool level: the
//     command text is never parsed, so a command that reaches the network
//     (curl) is invisible here. This is a documented tool-semantic
//     classification; later judge layers may override from content rules.
//   - MCP tools classified `network` are external; others are not (the tool
//     name is the only signal available).
//
// Unknown tools classify as unknown-but-sourced: toolName is preserved, so
// nothing is silently dropped.

interface ActionClassification {
  category: ActionCategory;
  reversible: boolean;
  external: boolean;
}

export const CODEX_ACTION_TABLE: Readonly<Record<string, ActionClassification>> = {
  Bash: { category: "execute", reversible: false, external: false },
  apply_patch: { category: "write", reversible: true, external: false },
  spawn_agent: { category: "execute", reversible: false, external: false },
  // Codex hosted tools emit NO tool hooks, so the codex exec stream is the
  // only signal for web searches — it must classify like Claude's WebSearch
  // or the cross-host equivalence promise breaks.
  WebSearch: { category: "network", reversible: true, external: true },
};

export const CLAUDE_ACTION_TABLE: Readonly<Record<string, ActionClassification>> = {
  Bash: { category: "execute", reversible: false, external: false },
  PowerShell: { category: "execute", reversible: false, external: false },
  Read: { category: "read", reversible: true, external: false },
  Glob: { category: "read", reversible: true, external: false },
  Grep: { category: "read", reversible: true, external: false },
  LSP: { category: "read", reversible: true, external: false },
  // Observes background tasks/processes — a read-only observation tool.
  Monitor: { category: "read", reversible: true, external: false },
  Write: { category: "write", reversible: true, external: false },
  Edit: { category: "write", reversible: true, external: false },
  NotebookEdit: { category: "write", reversible: true, external: false },
  WebFetch: { category: "network", reversible: true, external: true },
  WebSearch: { category: "network", reversible: true, external: true },
  // Delegated execution: a subagent can take any action, so the spawn itself
  // classifies as execute with no automatic undo.
  Agent: { category: "execute", reversible: false, external: false },
  Task: { category: "unknown", reversible: false, external: false },
  TaskCreate: { category: "unknown", reversible: false, external: false },
  TaskUpdate: { category: "unknown", reversible: false, external: false },
  // Interactive/questioning tools have no system effect of their own.
  AskUserQuestion: { category: "message", reversible: true, external: false },
  ExitPlanMode: { category: "message", reversible: true, external: false },
  // Official semantics: EndConversation SKIPS PreToolUse and PostToolUse
  // entirely, so this row only ever fires via the host stream path. The
  // normalizer fabricates nothing when the hooks don't fire (no gap, no
  // failure) — correct absence, recorded here so nobody "fixes" it.
  EndConversation: { category: "message", reversible: true, external: false },
  Skill: { category: "message", reversible: true, external: false },
};

/**
 * Name-based rules for mcp__<server>__<tool> names. The tool part is split
 * into tokens on non-alphanumerics and each token is matched against the
 * ordered rule sets — a token-based match, not a substring regex, so
 * `mcp__slack__post_message` classifies as publish (token "post") instead of
 * write, and `mcp__db__forget_row` does NOT classify as read via "get".
 * Order matters: publish/message precede the generic write tokens, and
 * network precedes read ("search" is a network token).
 * Fall-through is `unknown` (still sourced — toolName is preserved).
 */
const MCP_TOKEN_RULES: readonly {
  tokens: readonly string[];
  category: ActionCategory;
  external: boolean;
}[] = [
  { tokens: ["delete", "remove", "rm", "drop", "unlink", "truncate", "destroy", "purge"], category: "delete", external: false },
  { tokens: ["publish", "push", "broadcast", "share", "post", "send", "announce"], category: "publish", external: true },
  { tokens: ["message", "chat", "reply", "ask", "notify"], category: "message", external: false },
  { tokens: ["deploy", "release", "promote"], category: "deploy", external: false },
  { tokens: ["fetch", "download", "upload", "http", "api", "web", "browse", "url", "request", "search", "curl", "call"], category: "network", external: true },
  { tokens: ["execute", "exec", "run", "command", "bash", "shell", "terminal", "spawn", "start", "kill"], category: "execute", external: false },
  { tokens: ["write", "create", "update", "insert", "upsert", "apply", "patch", "put", "edit", "set", "save", "copy", "move", "rename"], category: "write", external: false },
  { tokens: ["read", "get", "list", "query", "find", "describe", "stat", "inspect", "lookup"], category: "read", external: false },
];

function classifyMcpTool(toolName: string): ActionClassification {
  // mcp__<server>__<tool>: classify on the tool part when the name allows.
  const rest = toolName.slice("mcp__".length);
  const separator = rest.lastIndexOf("__");
  const toolPart = (separator >= 0 ? rest.slice(separator + 2) : rest).toLowerCase();
  const tokens = new Set(toolPart.split(/[^a-z0-9]+/).filter((token) => token.length > 0));
  for (const rule of MCP_TOKEN_RULES) {
    for (const token of rule.tokens) {
      if (tokens.has(token)) {
        return { category: rule.category, reversible: false, external: rule.external };
      }
    }
  }
  return { category: "unknown", reversible: false, external: false };
}

function classifyByTable(host: Host, toolName: string): ActionClassification {
  if (toolName.startsWith("mcp__")) {
    return classifyMcpTool(toolName);
  }
  const table = host === "codex" ? CODEX_ACTION_TABLE : CLAUDE_ACTION_TABLE;
  return (
    table[toolName] ?? { category: "unknown", reversible: false, external: false }
  );
}

/**
 * Classify an already resource-normalized action candidate into an
 * ActionDescriptor. The security summary is derived text (tool name,
 * category, structural status, character and path counts) — never payload
 * content — and is capped at RAW_EVENT_LIMITS.maxSecuritySummaryChars.
 */
export function classifyNormalizedAction(
  candidate: NormalizedActionCandidate & { host: Host },
): ActionDescriptor {
  const classification = classifyByTable(candidate.host, candidate.toolName);
  const parts = [`${candidate.toolName}: ${classification.category}`];
  if (candidate.statusNote !== undefined) {
    parts.push(candidate.statusNote);
  }
  if (candidate.inputChars > 0) {
    parts.push(`input ${candidate.inputChars} chars`);
  }
  if (candidate.resourceRefs.length > 0) {
    parts.push(`${candidate.resourceRefs.length} path(s)`);
  }
  return {
    toolName: candidate.toolName,
    category: classification.category,
    reversible: classification.reversible,
    external: classification.external,
    resourceRefs: candidate.resourceRefs,
    securitySummary: parts
      .join(", ")
      .slice(0, RAW_EVENT_LIMITS.maxSecuritySummaryChars),
  };
}

/**
 * Public classifier: normalizes the resources of a tool call and classifies
 * its action semantics. Purely descriptive — it never reads contracts,
 * never decides allow/block, and never calls a Provider.
 */
export async function classifyAction(
  input: HostActionCandidate & { host: Host },
): Promise<ActionDescriptor> {
  return classifyNormalizedAction({
    ...(await normalizeResources(input)),
    host: input.host,
  });
}
