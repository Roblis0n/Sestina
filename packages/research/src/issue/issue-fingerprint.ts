import { cloneFrozen, isNonBlankString, isRecord } from "../domain-validation.js";
import { researchError } from "../errors.js";
import { canonicalStringify, stableResearchHash } from "../identity/canonical-json.js";
import { parseResearchIdFor } from "../identity/research-id.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";
import { parseScopeRule, type ScopeTarget } from "../brief/scope-rule.js";
import { parseIssueKind, type IssueKind } from "./issue-kind.js";

export interface IssueFingerprintInput {
  readonly kind: IssueKind;
  readonly target: ScopeTarget;
  readonly violatedCriterion: string;
  readonly rationaleConcepts: readonly string[];
  readonly sourceArtifactId: string;
  readonly lineageRootRevisionId: string;
}

export interface NormalizedIssueFingerprintInput extends IssueFingerprintInput {
  readonly targetKey: string;
}

function normalizeTerm(value: string): string {
  return value.normalize("NFKC").toLowerCase().trim().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
}

export function normalizeIssueFingerprintInput(input: unknown): ResearchResult<NormalizedIssueFingerprintInput> {
  if (!isRecord(input) || !isNonBlankString(input.violatedCriterion) || !Array.isArray(input.rationaleConcepts)) return err(researchError("invalid_issue_fingerprint"));
  const kind = parseIssueKind(input.kind); if (!kind.ok) return kind;
  const target = parseScopeRule({ target: input.target, operations: ["rewrite"] }); if (!target.ok) return target;
  const targetKey = canonicalStringify(target.value.target); if (!targetKey.ok) return targetKey;
  const sourceArtifactId = parseResearchIdFor(input.sourceArtifactId, "rart_"); if (!sourceArtifactId.ok) return sourceArtifactId;
  const lineageRootRevisionId = parseResearchIdFor(input.lineageRootRevisionId, "rrev_"); if (!lineageRootRevisionId.ok) return lineageRootRevisionId;
  const rationaleConcepts: string[] = [];
  for (const value of input.rationaleConcepts) {
    if (!isNonBlankString(value)) return err(researchError("invalid_issue_fingerprint"));
    const normalized = normalizeTerm(value);
    if (!rationaleConcepts.includes(normalized)) rationaleConcepts.push(normalized);
  }
  if (rationaleConcepts.length === 0) return err(researchError("invalid_issue_fingerprint"));
  rationaleConcepts.sort();
  return ok(cloneFrozen({ kind: kind.value, target: target.value.target, targetKey: targetKey.value, violatedCriterion: normalizeTerm(input.violatedCriterion), rationaleConcepts, sourceArtifactId: sourceArtifactId.value.id, lineageRootRevisionId: lineageRootRevisionId.value.id }));
}

export function createIssueFingerprint(input: IssueFingerprintInput): ResearchResult<string> {
  const normalized = normalizeIssueFingerprintInput(input); if (!normalized.ok) return normalized;
  return stableResearchHash({ kind: normalized.value.kind, target: normalized.value.target, violatedCriterion: normalized.value.violatedCriterion, rationaleConcepts: normalized.value.rationaleConcepts, sourceArtifactId: normalized.value.sourceArtifactId, lineageRootRevisionId: normalized.value.lineageRootRevisionId });
}
