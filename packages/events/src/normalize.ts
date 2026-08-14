import {
  EventIdSchema,
  ProjectIdSchema,
  SestinaError,
  SestinaErrorCode,
  StandardEventSchema,
  TaskIdSchema,
  generateId,
  isSestinaError,
  nowUTC,
  type ContentDescriptor,
  type EventType,
  type Host,
  type HostVisibilityLevel,
  type PrivacyClass,
  type StandardEvent,
} from "@sestina/schema";
import { enforceRawEventLimits } from "./limits.js";
import {
  buildActionFingerprint,
  buildIdempotencyKey,
  deriveDeterministicId,
  hostIdentityInput,
  hostSessionIdentity,
  sha256Hex,
  type IdempotencyPhase,
} from "./idempotency.js";
import {
  normalizeResources,
  type HostActionCandidate,
} from "./resource-normalizer.js";
import { classifyNormalizedAction } from "./action-classifier.js";
import { normalizeClaudeEvent } from "./hosts/claude-code.js";
import { normalizeCodexEvent } from "./hosts/codex.js";

// ── Result ─────────────────────────────────────────────────────────────────

/**
 * The schema package defines no Result type, so this package owns one.
 * Normalizers never throw across the API boundary: failures are honest
 * SestinaErrors with stable codes.
 */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: SestinaError };

// ── Input / output shapes ──────────────────────────────────────────────────

/**
 * host uses the wire spelling "claude-code" (per the task contract); the
 * normalized StandardEvent.host uses the schema's "claude_code".
 */
export interface NormalizeHostEventInput {
  host: "codex" | "claude-code";
  /**
   * Parsed JSON of the hook stdin / stream line. Exactly one of `raw` /
   * `rawBytes` must be provided — see enforceRawEventLimits: they are
   * mutually exclusive so the size gate, the payload hash and the parsed
   * content always describe the same bytes.
   */
  raw?: unknown;
  /**
   * Exact wire bytes. When present, `raw` must be absent: the normalizer
   * size-gates these bytes first and parses the payload from them, so they
   * are the single source of truth for content AND hash.
   */
  rawBytes?: Uint8Array;
  /**
   * Host session id hint. Required for codex exec --json lines (item events
   * carry no session/thread id) and honored for any event that carries none.
   */
  sessionId?: string;
  /** Optional real project binding (Task 8). Default: session-scoped derived id. */
  projectId?: string;
  /** Optional real task binding (Task 8). Default: session-scoped derived id. */
  taskId?: string;
  /** Override the raw byte cap (tests, tight callers). */
  maxBytes?: number;
  /**
   * Occurrence identity for stream lines whose payload is featureless
   * (e.g. Codex `{"type":"turn.started"}` — byte-identical across turns).
   * Stream readers must pass their line index here so each occurrence gets
   * its own idempotency key; without it such lines share a key.
   */
  occurrence?: string | number;
}

/**
 * A normalized event plus the host-native identifiers the schema cannot
 * carry. StandardEvent (frozen in packages/schema) has no field for the
 * host's tool call id — correlation and dedupe need it, so it travels in
 * this wrapper. Persisted events correlate by best-effort identity
 * (sessionId + action fingerprint + time window) instead.
 */
export interface NormalizedHostEvent {
  event: StandardEvent;
  hostToolCallId?: string;
  hostTurnId?: string;
  hostPhase?: IdempotencyPhase;
  nativeEventName?: string;
}

/**
 * Internal hand-off between the host adapters and the assembler.
 */
export interface NormalizedHostFields {
  eventType: EventType;
  host: Host;
  /** Host-native event name ("PostToolUse", "item.completed", ...). */
  nativeEventName: string;
  phase: IdempotencyPhase;
  /** The host's own session id (raw). */
  hostSessionId: string;
  toolCallId?: string;
  turnId?: string;
  occurredAt: string;
  bypass: boolean;
  privacyClass?: PrivacyClass;
  actionCandidate?: HostActionCandidate;
  content?: ContentDescriptor;
  sourceCapability: "hooks" | "stream";
  hostVisibilityLevel?: HostVisibilityLevel;
  /** Distinguishing lifecycle fields for the idempotency key. */
  discriminator?: string;
}

// ── Normalization entry points ────────────────────────────────────────────

/**
 * Normalize a raw host event (Codex or Claude Code hook stdin, or a host
 * stream line) into a schema-valid StandardEvent.
 *
 * Order (docs/22 Step 3, the contract):
 *   1. enforceRawEventLimits(input.raw) — size gate and bypass detection
 *      BEFORE any deep parsing; oversized payloads fail with limit_exceeded,
 *      unknown/malformed events with validation_failed,
 *   2. host-specific normalization (thin adapters in hosts/),
 *   3. classifyAction(normalizeResources(...)) — descriptive only,
 *   4. StandardEventSchema.safeParse with the deterministic idempotencyKey
 *      and rawPayloadHash = sha256 of the raw bytes.
 *
 * The normalizer NEVER reads contracts, NEVER decides allow/block, and NEVER
 * calls a Provider. Only the hook path may create governance decisions.
 *
 * NOTE: returns a Promise because hashing uses Web Crypto (renderer-neutral;
 * subtle.digest is async-only). The docs/22 skeleton was written synchronous
 * — the integrator should note this deviation.
 */
export async function normalizeHostEvent(
  input: NormalizeHostEventInput,
): Promise<Result<StandardEvent>> {
  const detailed = await normalizeHostEventDetailed(input);
  return detailed.ok ? { ok: true, value: detailed.value.event } : detailed;
}

/** Normalize and keep the host-native identifiers (correlation/dedupe input). */
export async function normalizeHostEventDetailed(
  input: NormalizeHostEventInput,
): Promise<Result<NormalizedHostEvent>> {
  try {
    const limited = enforceRawEventLimits(
      input.raw,
      input.rawBytes,
      input.maxBytes !== undefined ? { maxBytes: input.maxBytes } : undefined,
    );
    const fields =
      input.host === "codex"
        ? normalizeCodexEvent(limited, input.sessionId)
        : normalizeClaudeEvent(limited, input.sessionId);

    const action =
      fields.actionCandidate === undefined
        ? undefined
        : classifyNormalizedAction({
            ...(await normalizeResources(fields.actionCandidate)),
            host: fields.host,
          });

    // The canonical host-session identity mapping is a single exported
    // function (idempotency.ts) — correlation and Task 8's HostSessionService
    // consume the same derivation instead of re-deriving their own.
    const sessionId = await hostSessionIdentity(fields.host, fields.hostSessionId);
    const identityInput = hostIdentityInput(fields.host, fields.hostSessionId);
    const projectId =
      input.projectId !== undefined
        ? ProjectIdSchema.parse(input.projectId)
        : ProjectIdSchema.parse(
            await deriveDeterministicId("project", identityInput),
          );
    const taskId =
      input.taskId !== undefined
        ? TaskIdSchema.parse(input.taskId)
        : TaskIdSchema.parse(
            await deriveDeterministicId("task", identityInput),
          );

    const rawPayloadHash = await sha256Hex(limited.bytes);

    const idempotencyKey = await buildIdempotencyKey({
      host: fields.host,
      sessionId,
      projectId,
      nativeEventName: fields.nativeEventName,
      phase: fields.phase,
      toolCallId: fields.toolCallId,
      turnId: fields.turnId,
      actionFingerprint: buildActionFingerprint(action),
      discriminator: fields.discriminator,
      contentHash: rawPayloadHash,
      occurrence: input.occurrence,
    });

    const content = buildContentDescriptor(fields.content, action);

    const parsed = StandardEventSchema.safeParse({
      schemaVersion: "1.0.0",
      eventId: EventIdSchema.parse(generateId()),
      idempotencyKey,
      eventType: fields.eventType,
      host: fields.host,
      projectId,
      taskId,
      sessionId,
      action,
      content,
      occurredAt: fields.occurredAt,
      receivedAt: nowUTC(),
      bypass: fields.bypass,
      privacyClass: fields.privacyClass ?? "internal",
      rawPayloadHash,
      sourceCapability: fields.sourceCapability,
      hostVisibilityLevel: fields.hostVisibilityLevel,
    });
    if (!parsed.success) {
      return {
        ok: false,
        error: new SestinaError(
          SestinaErrorCode.validation_failed,
          "normalized event failed StandardEvent validation",
          undefined,
          // Only the issue codes and paths — Zod `received` values can carry
          // raw host content and must never land in error details.
          {
            issues: parsed.error.issues.map((issue) => ({
              code: issue.code,
              path: issue.path,
            })),
          },
        ),
      };
    }
    return {
      ok: true,
      value: {
        event: parsed.data,
        hostToolCallId: fields.toolCallId,
        hostTurnId: fields.turnId,
        hostPhase: fields.phase,
        nativeEventName: fields.nativeEventName,
      },
    };
  } catch (error) {
    if (isSestinaError(error)) {
      return { ok: false, error };
    }
    return {
      ok: false,
      error: new SestinaError(
        SestinaErrorCode.internal_error,
        "unexpected normalization failure",
      ),
    };
  }
}

/**
 * Content descriptors are counts/hasFlags only — payload bodies are NEVER
 * stored. The file count reflects the normalized action's resource refs.
 */
function buildContentDescriptor(
  base: ContentDescriptor | undefined,
  action: StandardEvent["action"],
): ContentDescriptor | undefined {
  if (base === undefined && action === undefined) {
    return undefined;
  }
  const refCount = action?.resourceRefs.length ?? 0;
  return {
    hasPrompt: base?.hasPrompt ?? false,
    promptLength: base?.promptLength,
    hasFiles: (base?.hasFiles ?? false) || refCount > 0,
    fileCount:
      base?.fileCount ?? (refCount > 0 ? refCount : undefined),
    hasOutput: base?.hasOutput ?? false,
    outputLength: base?.outputLength,
    totalChars: base?.totalChars ?? 0,
  };
}
