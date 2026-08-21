import { parseResearchIdFor } from "@sestina/research";
import { SESTINA_RELEASE_CONTRACT } from "@sestina/schema";
import { DEFAULT_CAPSULE_MAX_ITEMS_PER_SECTION, DEFAULT_CAPSULE_TEXT_MAX_BYTES, DEFAULT_RESPONSE_MAX_BYTES, utf8ByteLength } from "../limits.js";

export const CAPSULE_RESPONSE_SCHEMA_VERSION = SESTINA_RELEASE_CONTRACT.capsuleResponseSchemaVersion;
export const CAPSULE_RESPONSE_AUTHORITY = "model_proposed_candidate_only" as const;

const HASH_PATTERN = "^[0-9a-f]{64}$";
const RESEARCH_ID_PATTERNS = Object.freeze({
  projectId: "^rprj_[0-9A-HJKMNP-TV-Z]{26}$",
  briefVersionId: "^rbrf_[0-9A-HJKMNP-TV-Z]{26}$",
  artifactRevisionId: "^rrev_[0-9A-HJKMNP-TV-Z]{26}$",
});

export const CAPSULE_RESPONSE_REQUIRED_KEYS = Object.freeze([
  "schemaVersion",
  "authority",
  "projectId",
  "capsuleHash",
  "snapshotHash",
  "reviewInputHash",
  "briefVersionId",
  "artifactRevisionId",
  "response",
] as const);

export const CAPSULE_RESPONSE_BODY_REQUIRED_KEYS = Object.freeze(["summary", "findings"] as const);

export const CAPSULE_RESPONSE_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Sestina Review Capsule candidate response",
  type: "object",
  additionalProperties: false,
  required: CAPSULE_RESPONSE_REQUIRED_KEYS,
  properties: {
    schemaVersion: { type: "string", const: CAPSULE_RESPONSE_SCHEMA_VERSION },
    authority: { type: "string", const: CAPSULE_RESPONSE_AUTHORITY },
    projectId: { type: "string", pattern: RESEARCH_ID_PATTERNS.projectId },
    capsuleHash: { type: "string", pattern: HASH_PATTERN },
    snapshotHash: { type: "string", pattern: HASH_PATTERN },
    reviewInputHash: { type: "string", pattern: HASH_PATTERN },
    briefVersionId: { type: "string", pattern: RESEARCH_ID_PATTERNS.briefVersionId },
    artifactRevisionId: { type: "string", pattern: RESEARCH_ID_PATTERNS.artifactRevisionId },
    response: {
      type: "object",
      additionalProperties: false,
      required: CAPSULE_RESPONSE_BODY_REQUIRED_KEYS,
      properties: {
        summary: { type: "string", maxLength: DEFAULT_CAPSULE_TEXT_MAX_BYTES, description: `UTF-8 encoded value must not exceed ${DEFAULT_CAPSULE_TEXT_MAX_BYTES} bytes.` },
        findings: {
          type: "array",
          maxItems: DEFAULT_CAPSULE_MAX_ITEMS_PER_SECTION,
          items: { type: "string", maxLength: DEFAULT_CAPSULE_TEXT_MAX_BYTES, description: `UTF-8 encoded value must not exceed ${DEFAULT_CAPSULE_TEXT_MAX_BYTES} bytes.` },
        },
      },
    },
  },
  description: `The complete UTF-8 encoded response must not exceed ${DEFAULT_RESPONSE_MAX_BYTES} bytes. The importer enforces byte limits before accepting a candidate.`,
} as const);

export interface CapsuleResponseEnvelope {
  readonly schemaVersion: typeof CAPSULE_RESPONSE_SCHEMA_VERSION;
  readonly authority: typeof CAPSULE_RESPONSE_AUTHORITY;
  readonly projectId: string;
  readonly capsuleHash: string;
  readonly snapshotHash: string;
  readonly reviewInputHash: string;
  readonly briefVersionId: string;
  readonly artifactRevisionId: string;
  readonly response: { readonly summary: string; readonly findings: readonly string[] };
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...required].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function validateCapsuleResponseEnvelope(raw: unknown): CapsuleResponseEnvelope | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  if (!hasExactKeys(value, CAPSULE_RESPONSE_REQUIRED_KEYS)) return undefined;
  if (value.schemaVersion !== CAPSULE_RESPONSE_SCHEMA_VERSION || value.authority !== CAPSULE_RESPONSE_AUTHORITY) return undefined;
  if (!validHash(value.capsuleHash) || !validHash(value.snapshotHash) || !validHash(value.reviewInputHash)) return undefined;
  if (typeof value.projectId !== "string" || typeof value.briefVersionId !== "string" || typeof value.artifactRevisionId !== "string") return undefined;
  if (!parseResearchIdFor(value.projectId, "rprj_").ok || !parseResearchIdFor(value.briefVersionId, "rbrf_").ok || !parseResearchIdFor(value.artifactRevisionId, "rrev_").ok) return undefined;
  if (typeof value.response !== "object" || value.response === null || Array.isArray(value.response)) return undefined;
  const response = value.response as Record<string, unknown>;
  if (!hasExactKeys(response, CAPSULE_RESPONSE_BODY_REQUIRED_KEYS)) return undefined;
  if (typeof response.summary !== "string" || utf8ByteLength(response.summary) > DEFAULT_CAPSULE_TEXT_MAX_BYTES) return undefined;
  if (!Array.isArray(response.findings) || response.findings.length > DEFAULT_CAPSULE_MAX_ITEMS_PER_SECTION) return undefined;
  if (response.findings.some((item) => typeof item !== "string" || utf8ByteLength(item) > DEFAULT_CAPSULE_TEXT_MAX_BYTES)) return undefined;
  return value as unknown as CapsuleResponseEnvelope;
}
