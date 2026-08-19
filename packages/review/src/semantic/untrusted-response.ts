export type SemanticReviewErrorCode =
  | "invalid_request"
  | "invalid_json"
  | "invalid_response"
  | "request_mismatch"
  | "span_mismatch"
  | "limit_exceeded";

export interface SemanticReviewError {
  readonly code: SemanticReviewErrorCode;
  readonly message: string;
}

export type SemanticReviewResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SemanticReviewError };

const MESSAGES: Readonly<Record<SemanticReviewErrorCode, string>> = {
  invalid_request: "semantic review request is invalid",
  invalid_json: "semantic review response is not strict JSON",
  invalid_response: "semantic review response does not match the bounded schema",
  request_mismatch: "semantic review response does not match the locked request",
  span_mismatch: "semantic review evidence span does not match the locked text",
  limit_exceeded: "semantic review response exceeds a configured limit",
};

export function semanticReviewOk<T>(value: T): SemanticReviewResult<T> {
  return { ok: true, value };
}

export function semanticReviewErr<T = never>(code: SemanticReviewErrorCode): SemanticReviewResult<T> {
  return { ok: false, error: Object.freeze({ code, message: MESSAGES[code] }) };
}

export function parseUntrustedJson(input: unknown, maxBytes: number): SemanticReviewResult<unknown> {
  let text: string;
  if (typeof input === "string") {
    text = input;
  } else {
    try {
      text = JSON.stringify(input);
    } catch {
      return semanticReviewErr("invalid_response");
    }
  }
  if (new TextEncoder().encode(text).byteLength > maxBytes) return semanticReviewErr("limit_exceeded");
  if (typeof input !== "string") return semanticReviewOk(input);
  try {
    return semanticReviewOk(JSON.parse(text) as unknown);
  } catch {
    return semanticReviewErr("invalid_json");
  }
}
