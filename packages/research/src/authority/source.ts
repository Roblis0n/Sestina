/**
 * Research sources: who produced state, at which authority level, and at
 * what UTC instant. Sources missing any field, or carrying a non-UTC or
 * malformed timestamp, cannot be persisted.
 */
import { researchError } from "../errors.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";
import { validateResearchActor, type ResearchActor } from "./actor.js";
import {
  actorMatchesAuthority,
  isAuthorityLevel,
  type AuthorityLevel,
} from "./authority-level.js";

export interface ResearchSource {
  readonly actor: ResearchActor;
  readonly authority: AuthorityLevel;
  readonly recordedAt: string;
}

// Strict ISO 8601 UTC: date, T separator, time, optional fraction, and
// either Z or an equivalent +00:00 offset (normalized to Z).
const UTC_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|\+00:00)$/;

/**
 * Validate a UTC timestamp and return it in canonical Z form. Anything
 * without an explicit UTC marker, with a non-zero offset, or naming a
 * non-existent instant is rejected.
 */
export function validateUtcTimestamp(value: unknown): ResearchResult<string> {
  if (typeof value !== "string") {
    return err(researchError("invalid_timestamp", { reason: "not_a_string" }));
  }
  const match = UTC_RE.exec(value);
  if (match === null) {
    return err(researchError("invalid_timestamp", { reason: "not_utc_iso8601" }));
  }
  const normalized = value.endsWith("Z") ? value : `${value.slice(0, -"+00:00".length)}Z`;
  // Pure parse of the normalized string (never the current time).
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return err(researchError("invalid_timestamp", { reason: "not_a_real_instant" }));
  }
  // Reject auto-rolled dates such as 2026-02-30 by comparing components.
  const components = [
    [match[1], parsed.getUTCFullYear()],
    [match[2], parsed.getUTCMonth() + 1],
    [match[3], parsed.getUTCDate()],
    [match[4], parsed.getUTCHours()],
    [match[5], parsed.getUTCMinutes()],
    [match[6], parsed.getUTCSeconds()],
  ] as const;
  for (const [text, actual] of components) {
    if (Number(text) !== actual) {
      return err(
        researchError("invalid_timestamp", { reason: "not_a_real_instant" }),
      );
    }
  }
  return ok(normalized);
}

/** Validate a full research source: actor, authority pairing and instant. */
export function parseResearchSource(input: unknown): ResearchResult<ResearchSource> {
  if (typeof input !== "object" || input === null) {
    return err(researchError("invalid_source"));
  }
  const record = input as Record<string, unknown>;

  const actor = validateResearchActor(record.actor);
  if (!actor.ok) return actor;

  const authority = record.authority;
  if (!isAuthorityLevel(authority)) {
    return err(researchError("invalid_authority_level"));
  }

  const recordedAt = validateUtcTimestamp(record.recordedAt);
  if (!recordedAt.ok) {
    return err(researchError("invalid_timestamp", recordedAt.error.details));
  }

  if (!actorMatchesAuthority(actor.value, authority)) {
    return err(
      researchError("authority_conflict", {
        actorKind: actor.value.kind,
        authority,
      }),
    );
  }

  return ok({ actor: actor.value, authority, recordedAt: recordedAt.value });
}
