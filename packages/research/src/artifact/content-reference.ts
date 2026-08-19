import { createHash } from "node:crypto";
import {
  cloneFrozen,
  isRecord,
  parseSafeRelativePath,
} from "../domain-validation.js";
import { researchError } from "../errors.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";

export type ResearchMediaType =
  | "text/markdown"
  | "text/plain"
  | "application/json";

export interface ContentReference {
  readonly storage: "inline" | "project_file";
  readonly mediaType: ResearchMediaType;
  readonly relativePath?: string;
  readonly contentHash: string;
  readonly byteLength: number;
}

const MEDIA_TYPES: readonly ResearchMediaType[] = [
  "text/markdown",
  "text/plain",
  "application/json",
];

export function contentReferenceForInline(
  content: unknown,
  mediaType: unknown,
): ResearchResult<{
  readonly reference: ContentReference;
  readonly content: string;
}> {
  if (
    typeof content !== "string" ||
    typeof mediaType !== "string" ||
    !MEDIA_TYPES.includes(mediaType as ResearchMediaType)
  ) {
    return err(researchError("invalid_content_reference"));
  }
  if (mediaType === "application/json") {
    try {
      JSON.parse(content);
    } catch {
      return err(researchError("invalid_content_reference"));
    }
  }
  const bytes = new TextEncoder().encode(content);
  return ok(
    cloneFrozen({
      content,
      reference: {
        storage: "inline" as const,
        mediaType: mediaType as ResearchMediaType,
        contentHash: createHash("sha256").update(bytes).digest("hex"),
        byteLength: bytes.byteLength,
      },
    }),
  );
}

export function parseContentReference(
  input: unknown,
): ResearchResult<ContentReference> {
  if (
    !isRecord(input) ||
    (input.storage !== "inline" && input.storage !== "project_file") ||
    typeof input.mediaType !== "string" ||
    !MEDIA_TYPES.includes(input.mediaType as ResearchMediaType) ||
    typeof input.contentHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(input.contentHash) ||
    typeof input.byteLength !== "number" ||
    !Number.isSafeInteger(input.byteLength) ||
    input.byteLength < 0
  ) {
    return err(researchError("invalid_content_reference"));
  }
  if (input.storage === "inline") {
    if (input.relativePath !== undefined) {
      return err(researchError("invalid_content_reference"));
    }
    return ok(
      cloneFrozen({
        storage: "inline" as const,
        mediaType: input.mediaType as ResearchMediaType,
        contentHash: input.contentHash,
        byteLength: input.byteLength,
      }),
    );
  }
  const path = parseSafeRelativePath(input.relativePath);
  if (!path.ok) return path;
  return ok(
    cloneFrozen({
      storage: "project_file" as const,
      mediaType: input.mediaType as ResearchMediaType,
      relativePath: path.value,
      contentHash: input.contentHash,
      byteLength: input.byteLength,
    }),
  );
}
