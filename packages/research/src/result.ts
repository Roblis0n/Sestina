import type { ResearchError } from "./errors.js";

/**
 * Result type for the research domain: failures carry a stable-code
 * `ResearchError` instead of throwing content-bearing exceptions.
 */
export type ResearchResult<T, E extends ResearchError = ResearchError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): ResearchResult<T> {
  return { ok: true, value };
}

export function err<E extends ResearchError>(error: E): ResearchResult<never, E> {
  return { ok: false, error };
}
