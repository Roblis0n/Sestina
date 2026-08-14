import {
  EventIdSchema,
  generateId,
  nowUTC,
  type ContentDescriptor,
  type EventType,
} from "@sestina/schema";
import { buildActionFingerprint, sha256Hex } from "./idempotency.js";
import type { NormalizedHostEvent } from "./normalize.js";

// ── Stream gaps ────────────────────────────────────────────────────────────

export interface StreamGap {
  /** First sequence number in the discontinuity window. */
  from: number;
  /** Last sequence number in the discontinuity window. */
  to: number;
}

/**
 * Explicit gap marker for host sequence discontinuities. `previous + 1 <
 * current` reports the skipped range [previous+1, current-1]; a regression
 * (current < previous) reports the window [current, previous]; identical
 * sequences are duplicates, not gaps. A gap is NEVER silently swallowed —
 * every correlation result carries it when one exists.
 */
export function detectStreamGap(
  previous: number | undefined,
  current: number | undefined,
): StreamGap | null {
  if (previous === undefined || current === undefined) {
    return null;
  }
  if (current === previous) {
    return null;
  }
  if (current > previous) {
    return current === previous + 1 ? null : { from: previous + 1, to: current - 1 };
  }
  return { from: current, to: previous };
}

// ── Correlation ────────────────────────────────────────────────────────────

export type CorrelationMismatchReason =
  | "host_mismatch"
  | "session_mismatch"
  | "scope_mismatch"
  | "phase_mismatch"
  | "tool_call_id_mismatch"
  | "missing_tool_call_id"
  | "action_fingerprint_mismatch"
  | "missing_action_fingerprint"
  | "time_window";

export interface CorrelateHostAndHookOptions {
  /** Sequence of the stream event in its host stream. */
  streamSequence?: number;
  /** Sequence of the previous stream event (gap detection input). */
  previousStreamSequence?: number;
  /** Max |occurredAt| distance for a merge. Default 60_000 ms. */
  maxTimeWindowMs?: number;
}

/**
 * Merge rules (docs/22 Step 4):
 * the same tool call seen via the host stream AND the hook path merges when
 *   - both events share the host,
 *   - both share the derived sessionId (same host session),
 *   - both share the same project/task scope (a caller-bound override on
 *     one path only is a scope mismatch — never a silent cross-binding),
 *   - the host tool call ids are present and equal (identity before phase —
 *     a phase comparison across different calls is meaningless),
 *   - the phases are compatible: stream pre <-> pre_tool,
 *     stream post <-> post_tool, stream failure <-> tool_failure,
 *   - the action fingerprints match (toolName|category|resourceRefs),
 *   - the occurredAt distance fits maxTimeWindowMs.
 * Any mismatch keeps BOTH events and marks possible_duplicate with the first
 * failing reason. A host sequence gap is attached explicitly in every case.
 *
 * Only the hook path may create governance decisions — correlation is
 * bookkeeping; the merged record uses the hook's eventType and action (the
 * hook is the governance authority) and the stream's richer body.
 *
 * Known asymmetry (documented, spec-true): Claude stream-json `user` lines
 * carry tool_result blocks with a tool_use_id but NO tool name, so their
 * events have no action descriptor. They can therefore never satisfy the
 * fingerprint rule and always report missing_action_fingerprint — the spec
 * says unprovable-same means keep both and mark possible_duplicate, and
 * that is what happens. Carrying tool names across stream lines is a
 * downstream task (Task 9); until then the hook path stays authoritative.
 *
 * Persistence note: the merged record is a display/bookkeeping view — its
 * idempotency key is the stream's (equal to the hook's by construction in
 * the merged case) but its rawPayloadHash is a combination hash and its
 * eventId is new. Consumers should NOT persist the merged row into the
 * events table as a third record; persist the originals and derive the
 * merged view, or handle the merged hash explicitly in their reuse check.
 */
export type CorrelationResult =
  | { kind: "merged"; merged: NormalizedHostEvent; gap: StreamGap | null }
  | {
      kind: "possible_duplicate";
      stream: NormalizedHostEvent;
      hook: NormalizedHostEvent;
      reason: CorrelationMismatchReason;
      gap: StreamGap | null;
    };

const PHASE_TO_HOOK_EVENT_TYPE: Partial<Record<string, EventType>> = {
  pre: "pre_tool",
  post: "post_tool",
  failure: "tool_failure",
};

export async function correlateHostAndHook(
  stream: NormalizedHostEvent,
  hook: NormalizedHostEvent,
  options: CorrelateHostAndHookOptions = {},
): Promise<CorrelationResult> {
  const gap = detectStreamGap(options.previousStreamSequence, options.streamSequence);
  const maxTimeWindowMs = options.maxTimeWindowMs ?? 60_000;

  const streamEvent = stream.event;
  const hookEvent = hook.event;

  const mismatch = (reason: CorrelationMismatchReason): CorrelationResult => ({
    kind: "possible_duplicate",
    stream,
    hook,
    reason,
    gap,
  });

  if (streamEvent.host !== hookEvent.host) {
    return mismatch("host_mismatch");
  }
  if (streamEvent.sessionId !== hookEvent.sessionId) {
    return mismatch("session_mismatch");
  }
  if (
    streamEvent.projectId !== hookEvent.projectId ||
    streamEvent.taskId !== hookEvent.taskId
  ) {
    return mismatch("scope_mismatch");
  }
  if (
    stream.hostToolCallId === undefined ||
    hook.hostToolCallId === undefined
  ) {
    return mismatch("missing_tool_call_id");
  }
  if (stream.hostToolCallId !== hook.hostToolCallId) {
    return mismatch("tool_call_id_mismatch");
  }
  const streamPhase = stream.hostPhase;
  const expectedHookEventType =
    streamPhase === undefined ? undefined : PHASE_TO_HOOK_EVENT_TYPE[streamPhase];
  if (
    expectedHookEventType === undefined ||
    hookEvent.eventType !== expectedHookEventType
  ) {
    return mismatch("phase_mismatch");
  }
  const streamFingerprint = buildActionFingerprint(streamEvent.action);
  const hookFingerprint = buildActionFingerprint(hookEvent.action);
  if (streamEvent.action === undefined || hookEvent.action === undefined) {
    return mismatch("missing_action_fingerprint");
  }
  if (streamFingerprint !== hookFingerprint) {
    return mismatch("action_fingerprint_mismatch");
  }
  const distance = Math.abs(
    Date.parse(streamEvent.occurredAt) - Date.parse(hookEvent.occurredAt),
  );
  if (distance > maxTimeWindowMs) {
    return mismatch("time_window");
  }

  const merged: NormalizedHostEvent = {
    event: {
      ...streamEvent,
      eventId: EventIdSchema.parse(generateId()),
      eventType: hookEvent.eventType,
      action: hookEvent.action ?? streamEvent.action,
      content: mergeContent(streamEvent.content, hookEvent.content),
      occurredAt:
        Date.parse(streamEvent.occurredAt) <= Date.parse(hookEvent.occurredAt)
          ? streamEvent.occurredAt
          : hookEvent.occurredAt,
      receivedAt: nowUTC(),
      bypass: streamEvent.bypass || hookEvent.bypass,
      rawPayloadHash: await sha256Hex(
        new TextEncoder().encode(
          `${streamEvent.rawPayloadHash}\u0000${hookEvent.rawPayloadHash}`,
        ),
      ),
      sourceCapability: "hooks+stream",
    },
    hostToolCallId: hook.hostToolCallId ?? stream.hostToolCallId,
    hostTurnId: hook.hostTurnId ?? stream.hostTurnId,
    hostPhase: hook.hostPhase,
    nativeEventName: hook.nativeEventName,
  };
  return { kind: "merged", merged, gap };
}

function mergeContent(
  stream: ContentDescriptor | undefined,
  hook: ContentDescriptor | undefined,
): ContentDescriptor | undefined {
  if (stream === undefined) {
    return hook;
  }
  if (hook === undefined) {
    return stream;
  }
  return {
    hasPrompt: stream.hasPrompt || hook.hasPrompt,
    promptLength: Math.max(stream.promptLength ?? 0, hook.promptLength ?? 0),
    hasFiles: stream.hasFiles || hook.hasFiles,
    fileCount: Math.max(stream.fileCount ?? 0, hook.fileCount ?? 0),
    hasOutput: stream.hasOutput || hook.hasOutput,
    outputLength: Math.max(stream.outputLength ?? 0, hook.outputLength ?? 0),
    totalChars: stream.totalChars + hook.totalChars,
  };
}
