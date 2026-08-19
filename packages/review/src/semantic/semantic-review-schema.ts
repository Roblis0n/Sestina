export const SEMANTIC_REVIEW_RESPONSE_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["protocolVersion", "reviewRunId", "inputHash", "inputSnapshotHash", "requestHash", "reviewer", "findings"],
  properties: {
    protocolVersion: { const: "1.0.0" },
    reviewRunId: { type: "string" },
    inputHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
    inputSnapshotHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
    requestHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
    reviewer: {
      type: "object", additionalProperties: false,
      properties: { provider: { type: "string" }, model: { type: "string" }, sessionId: { type: "string" } },
    },
    findings: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "kind", "target", "baselineEvidence", "candidateEvidence", "decisionIds", "criterionId", "rationale", "minimalCorrection", "confidence"],
      },
    },
  },
} as const);
