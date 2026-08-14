import {
  SestinaError,
  SestinaErrorCode,
  type ActionDescriptor,
  type Host,
} from "@sestina/schema";

// ── Crypto helpers ─────────────────────────────────────────────────────────
// Runtime-neutral: Web Crypto + TextEncoder only. No node: imports, so the
// renderer can import this package. Web Crypto's digest API is async-only,
// which is why the normalizer functions return Promises (documented in
// normalize.ts).

/** sha256 of the given bytes as a 64-char lowercase hex string. */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** Base64url (RFC 4648 section 5) of the given bytes, without padding. */
export function base64Url(bytes: Uint8Array): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let result = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      result += alphabet[(buffer >> bits) & 0x3f] ?? "";
    }
  }
  if (bits > 0) {
    result += alphabet[(buffer << (6 - bits)) & 0x3f] ?? "";
  }
  return result;
}

/**
 * Cheap, deterministic 64-bit FNV-1a (16 hex chars) for discriminator text.
 * NOT cryptographic — used only to keep idempotency keys of structurally
 * distinct lifecycle/stream payloads apart.
 */
export function fnv1aHex(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= BigInt(value.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

// ── Deterministic ULIDs ────────────────────────────────────────────────────
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Encode exactly 16 bytes as a 26-char Crockford base32 (ULID) string. */
export function ulidFromBytes(bytes: Uint8Array): string {
  if (bytes.length !== 16) {
    throw new SestinaError(
      SestinaErrorCode.internal_error,
      "ulidFromBytes requires exactly 16 bytes",
    );
  }
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  let result = "";
  // 26 chars x 5 bits = 130 bits > 128, so the top char carries only 3 bits —
  // the standard ULID layout (48-bit timestamp part has 2 leading zero bits).
  for (let i = 0; i < 26; i += 1) {
    const shift = 125 - 5 * i;
    result += CROCKFORD_ALPHABET[Number((value >> BigInt(shift)) & 0x1fn)] ?? "";
  }
  return result;
}

/**
 * Derive a deterministic, schema-valid ULID from a namespace and an input.
 * The same (namespace, input) always maps to the same ID — used for host
 * session/project/task identities so every event of one host session shares
 * its derived identifiers (idempotency keys and correlation depend on it).
 */
export async function deriveDeterministicId(
  namespace: string,
  input: string,
): Promise<string> {
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${namespace}\u0000${input}`),
    ),
  );
  return ulidFromBytes(digest.slice(0, 16));
}

// ── Action fingerprints ────────────────────────────────────────────────────

/**
 * Canonical fingerprint of an action's semantics: toolName|category|refs.
 * Only classification inputs participate — never payload content — so the
 * fingerprint is stable between the hook and host-stream views of one call.
 */
export function buildActionFingerprint(action: ActionDescriptor | undefined): string {
  if (action === undefined) {
    return "-";
  }
  const refs = [...action.resourceRefs].sort().join(",");
  return `${action.toolName ?? "?"}|${action.category}|${refs}`;
}

// ── Idempotency keys ───────────────────────────────────────────────────────

/**
 * Canonical phase tokens. A token identifies one stage of a tool call in a
 * way that is consistent across the two delivery paths:
 *   hook PreToolUse <-> stream item.started       = "pre"
 *   hook PostToolUse <-> stream item.completed    = "post"
 *   hook PostToolUseFailure / failed stream       = "failure"
 * Stream-only intermediate deltas use "update"; PostToolBatch uses "batch";
 * non-tool events use "lifecycle" or "stream".
 */
export type IdempotencyPhase =
  | "pre"
  | "permission"
  | "post"
  | "failure"
  | "update"
  | "batch"
  | "lifecycle"
  | "stream";

export interface IdempotencyKeyInput {
  host: Host;
  /** Derived Sestina session id (deterministic for the host session). */
  sessionId: string;
  /** Derived (or caller-bound) Sestina project id — the key is scoped to it. */
  projectId: string;
  /** Host-native event name ("PostToolUse", "item.completed", ...). */
  nativeEventName: string;
  phase: IdempotencyPhase;
  /** Host tool call id (tool_use_id / stream item id). */
  toolCallId?: string;
  /** Host turn id — used when toolCallId is absent (stream lines carry none). */
  turnId?: string;
  /** buildActionFingerprint output for tool events. */
  actionFingerprint?: string;
  /** Lifecycle distinguishing fields, e.g. "source=startup" or "reason=other". */
  discriminator?: string;
  /**
   * sha256 of the exact raw bytes (rawPayloadHash). Included whenever the
   * key lacks a per-occurrence identity: tool events without a tool call id
   * (both hosts' PermissionRequest), stream "update" deltas of one call, and
   * every lifecycle/stream event. Two distinct occurrences can then never
   * share a key, while the same bytes still yield the same key.
   */
  contentHash?: string;
  /**
   * Caller-supplied occurrence identity (e.g. the stream line index) for
   * stream lines whose payload is featureless (Codex `{"type":"turn.started"}`
   * is byte-identical across turns). Stream readers must pass it; without it
   * such lines share a key (documented honest degradation — the package
   * cannot invent identity).
   */
  occurrence?: string | number;
}

/**
 * Build the deterministic idempotency key.
 *
 * Tool events (pre/permission/post/failure/batch): host, session, project,
 * phase, toolCallId ("-" when absent — Codex and Claude PermissionRequest
 * carry none), turn (only when toolCallId is absent), action fingerprint,
 * and — for phases without a tool call id, and always for "update" deltas —
 * the raw-content hash so distinct occurrences stay distinct.
 * Lifecycle/stream events: host, session, project, native event name, turn,
 * discriminator (distinguishing input fields: source, reason, trigger,
 * agent_id, ...), the raw-content hash, and the caller-supplied occurrence.
 *
 * The same logical event always yields the same key — including the same
 * tool call observed through the hook path and the host stream — while
 * PreToolUse and PostToolUse of one call stay distinct via the phase token.
 * Keys never collide across hosts or projects (both are key components).
 */
export async function buildIdempotencyKey(
  input: IdempotencyKeyInput,
): Promise<string> {
  const parts: string[] = [input.host, input.sessionId, input.projectId];
  if (input.phase === "lifecycle" || input.phase === "stream") {
    parts.push(
      input.nativeEventName,
      input.turnId ?? "-",
      input.discriminator ?? "-",
      input.contentHash ?? "-",
    );
    if (input.occurrence !== undefined) {
      parts.push(String(input.occurrence));
    }
  } else {
    parts.push(input.phase, input.toolCallId ?? "-");
    if (input.toolCallId === undefined) {
      parts.push(input.turnId ?? "-", input.contentHash ?? "-");
    }
    if (input.phase === "update") {
      // Deltas of one call share the tool call id but differ in content.
      parts.push(input.contentHash ?? "-");
    }
    parts.push(input.actionFingerprint ?? "-");
  }
  const canonical = parts.join("\u0000");
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(canonical),
    ),
  );
  return `evt_${base64Url(digest)}`;
}
