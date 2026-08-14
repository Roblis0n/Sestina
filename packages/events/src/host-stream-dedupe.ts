import type { NormalizedHostEvent } from "./normalize.js";

/**
 * Host-stream dedupe.
 *
 * Repeated stream events for the SAME tool call (item.started /
 * item.updated / item.completed deltas) collapse into one state.
 *
 * Identity = host + sessionId + hostTurnId (when present) + host tool call
 * id. The winner is NOT plain arrival order: a terminal phase (post =
 * completed, failure = failed) always beats a non-terminal one (pre =
 * started, update = in progress) regardless of which arrived later — a
 * stale in_progress delta must never overwrite the terminal state. Ties
 * within a phase rank fall back to occurredAt, then input order. Events of
 * a different session/turn, a different tool call, without a tool call id,
 * or with a non-host_stream eventType pass through untouched — the schema
 * has no tool-call-id field, so best-effort identity is impossible for them
 * and the function refuses to guess.
 */

const TERMINAL_PHASES = new Set(["post", "failure"]);

function phaseRank(phase: string | undefined): number {
  if (phase === undefined) {
    return 0;
  }
  return TERMINAL_PHASES.has(phase) ? 1 : 0;
}

export function dedupeHostStreamEvent(
  events: readonly NormalizedHostEvent[],
): NormalizedHostEvent[] {
  const latest = new Map<string, { index: number; event: NormalizedHostEvent }>();
  let index = 0;
  for (const event of events) {
    if (event.event.eventType === "host_stream" && event.hostToolCallId !== undefined) {
      const key = [
        event.event.host,
        event.event.sessionId,
        event.hostTurnId ?? "-",
        event.hostToolCallId,
      ].join("\u0000");
      const existing = latest.get(key);
      if (
        existing === undefined ||
        isBetter(event, existing.event, index, existing.index)
      ) {
        latest.set(key, { index, event });
      }
    }
    index += 1;
  }

  const winners = new Set<NormalizedHostEvent>();
  for (const entry of latest.values()) {
    winners.add(entry.event);
  }
  const output: NormalizedHostEvent[] = [];
  for (const event of events) {
    if (
      event.event.eventType !== "host_stream" ||
      event.hostToolCallId === undefined
    ) {
      output.push(event);
    } else if (winners.has(event)) {
      output.push(event);
    }
  }
  return output;
}

function isBetter(
  a: NormalizedHostEvent,
  b: NormalizedHostEvent,
  aIndex: number,
  bIndex: number,
): boolean {
  const aRank = phaseRank(a.hostPhase);
  const bRank = phaseRank(b.hostPhase);
  if (aRank !== bRank) {
    return aRank > bRank;
  }
  const aTime = Date.parse(a.event.occurredAt);
  const bTime = Date.parse(b.event.occurredAt);
  if (aTime !== bTime) {
    return aTime > bTime;
  }
  return aIndex > bIndex;
}
