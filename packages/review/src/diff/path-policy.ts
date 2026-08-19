import { reviewErr, reviewError, reviewOk, type ReviewResult } from "../review-result.js";

export function parseProjectRelativePath(input: unknown): ReviewResult<string> {
  if (typeof input !== "string" || input.trim().length === 0 || input.includes("\0")) return reviewErr(reviewError("invalid_review_context"));
  let decoded = input.trim();
  try {
    for (let index = 0; index < 3; index += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch { return reviewErr(reviewError("invalid_review_context")); }
  const normalized = decoded.replaceAll("\\", "/").replace(/\/+/g, "/");
  if (normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || /^\/{2}/.test(decoded.replaceAll("\\", "/")) || /^[a-z][a-z0-9+.-]*:/i.test(normalized)) return reviewErr(reviewError("invalid_review_context"));
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return reviewErr(reviewError("invalid_review_context"));
  return reviewOk(segments.join("/"));
}
