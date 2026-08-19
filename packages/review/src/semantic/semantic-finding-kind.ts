export const SEMANTIC_FINDING_KINDS = [
  "focus_substitution",
  "audit_hijacking",
  "semantic_scope_violation",
  "decision_integrity",
  "argument_delta",
  "shallow_abstraction",
  "evidence_boundary",
] as const;

export type SemanticFindingKind = (typeof SEMANTIC_FINDING_KINDS)[number];

export function isSemanticFindingKind(value: unknown): value is SemanticFindingKind {
  return typeof value === "string" && (SEMANTIC_FINDING_KINDS as readonly string[]).includes(value);
}
