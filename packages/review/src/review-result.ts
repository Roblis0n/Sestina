export type ReviewErrorCode =
  | "invalid_review_context"
  | "review_input_hash_mismatch"
  | "invalid_checker"
  | "duplicate_checker"
  | "invalid_finding"
  | "invalid_review_run"
  | "review_version_conflict"
  | "review_not_found"
  | "review_storage_unavailable";

export interface ReviewError {
  readonly code: ReviewErrorCode;
  readonly message: string;
}

const MESSAGES: Readonly<Record<ReviewErrorCode, string>> = {
  invalid_review_context: "review context is invalid",
  review_input_hash_mismatch: "review input hash does not match its locked context",
  invalid_checker: "checker result is invalid",
  duplicate_checker: "duplicate checker ID/version",
  invalid_finding: "review finding is invalid",
  invalid_review_run: "review run is invalid",
  review_version_conflict: "review run version conflict",
  review_not_found: "review run was not found in the requested project",
  review_storage_unavailable: "review storage operation failed",
};

export function reviewError(code: ReviewErrorCode): ReviewError {
  return Object.freeze({ code, message: MESSAGES[code] });
}

export type ReviewResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ReviewError };
export function reviewOk<T>(value: T): ReviewResult<T> { return { ok: true, value }; }
export function reviewErr<T = never>(error: ReviewError): ReviewResult<T> { return { ok: false, error }; }

export function cloneReviewValue<T>(value: T): T {
  const cloned = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (typeof item !== "object" || item === null || Object.isFrozen(item)) return;
    for (const value of Object.values(item)) freeze(value);
    Object.freeze(item);
  };
  freeze(cloned);
  return cloned;
}
