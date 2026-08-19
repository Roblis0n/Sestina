import { parseResearchIdFor, stableResearchHash } from "@sestina/research";
import { semanticReviewErr, semanticReviewOk, type SemanticReviewResult } from "./untrusted-response.js";

export const STABLE_TEXT_NORMALIZATION_VERSION = "nfkc-lf-v1" as const;
export const STABLE_TEXT_INDEX_UNIT = "utf16_code_unit" as const;

export interface StableTextDocument {
  readonly projectId: string;
  readonly artifactId: string;
  readonly revisionId: string;
  readonly normalizedText: string;
  readonly normalizedTextHash: string;
  readonly normalizationVersion: typeof STABLE_TEXT_NORMALIZATION_VERSION;
  readonly indexUnit: typeof STABLE_TEXT_INDEX_UNIT;
}

export interface StableTextSpan {
  readonly projectId: string;
  readonly artifactId: string;
  readonly revisionId: string;
  readonly normalizedTextHash: string;
  readonly start: number;
  readonly end: number;
  readonly quote: string;
  readonly quoteHash: string;
  readonly normalizationVersion: typeof STABLE_TEXT_NORMALIZATION_VERSION;
  readonly indexUnit: typeof STABLE_TEXT_INDEX_UNIT;
}

export interface StableTextDocumentInput {
  readonly projectId: string;
  readonly artifactId: string;
  readonly revisionId: string;
  readonly text: string;
}

export function normalizeStableText(text: string): string {
  return text.replace(/\r\n?/g, "\n").normalize("NFKC");
}

function textHash(text: string): string | undefined {
  const result = stableResearchHash({ normalizationVersion: STABLE_TEXT_NORMALIZATION_VERSION, text });
  return result.ok ? result.value : undefined;
}

export function createStableTextDocument(input: StableTextDocumentInput): SemanticReviewResult<StableTextDocument> {
  const project = parseResearchIdFor(input.projectId, "rprj_");
  const artifact = parseResearchIdFor(input.artifactId, "rart_");
  const revision = parseResearchIdFor(input.revisionId, "rrev_");
  if (!project.ok || !artifact.ok || !revision.ok || typeof input.text !== "string") return semanticReviewErr("invalid_request");
  const normalizedText = normalizeStableText(input.text);
  const normalizedTextHash = textHash(normalizedText);
  if (normalizedTextHash === undefined) return semanticReviewErr("invalid_request");
  return semanticReviewOk(Object.freeze({
    projectId: project.value.id,
    artifactId: artifact.value.id,
    revisionId: revision.value.id,
    normalizedText,
    normalizedTextHash,
    normalizationVersion: STABLE_TEXT_NORMALIZATION_VERSION,
    indexUnit: STABLE_TEXT_INDEX_UNIT,
  }));
}

export function createStableTextSpan(document: StableTextDocument, start: number, end: number): SemanticReviewResult<StableTextSpan> {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > document.normalizedText.length) return semanticReviewErr("span_mismatch");
  const quote = document.normalizedText.slice(start, end);
  const quoteHash = textHash(quote);
  if (quoteHash === undefined) return semanticReviewErr("span_mismatch");
  return semanticReviewOk(Object.freeze({
    projectId: document.projectId,
    artifactId: document.artifactId,
    revisionId: document.revisionId,
    normalizedTextHash: document.normalizedTextHash,
    start,
    end,
    quote,
    quoteHash,
    normalizationVersion: document.normalizationVersion,
    indexUnit: document.indexUnit,
  }));
}

export function validateStableTextSpan(span: unknown, document: StableTextDocument): SemanticReviewResult<StableTextSpan> {
  if (typeof span !== "object" || span === null || Array.isArray(span)) return semanticReviewErr("span_mismatch");
  const value = span as Record<string, unknown>;
  const keys = ["artifactId", "end", "indexUnit", "normalizationVersion", "normalizedTextHash", "projectId", "quote", "quoteHash", "revisionId", "start"];
  if (Object.keys(value).sort().join("|") !== keys.sort().join("|")) return semanticReviewErr("span_mismatch");
  if (value.projectId !== document.projectId || value.artifactId !== document.artifactId || value.revisionId !== document.revisionId || value.normalizedTextHash !== document.normalizedTextHash || value.normalizationVersion !== document.normalizationVersion || value.indexUnit !== document.indexUnit || typeof value.start !== "number" || typeof value.end !== "number") return semanticReviewErr("span_mismatch");
  const expected = createStableTextSpan(document, value.start, value.end);
  if (!expected.ok || value.quote !== expected.value.quote || value.quoteHash !== expected.value.quoteHash) return semanticReviewErr("span_mismatch");
  return expected;
}
