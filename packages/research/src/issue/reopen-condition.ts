import { cloneFrozen, isRecord } from "../domain-validation.js";
import { researchError } from "../errors.js";
import { parseResearchIdFor } from "../identity/research-id.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";

export interface IssueReopenContext {
  readonly currentRevisionContentHash?: string;
  readonly resolutionEvidenceStale?: boolean;
  readonly currentBriefVersionId?: string;
  readonly currentFrozenDecisionIds?: readonly string[];
  readonly newEvidenceContradicts?: boolean;
  readonly userRequested?: boolean;
}

export interface IssueResolutionContext {
  readonly resolutionEvidenceId: string;
  readonly briefVersionId?: string;
  readonly frozenDecisionIds: readonly string[];
  readonly revisionContentHash: string;
}

export function parseIssueResolutionContext(input: unknown, revisionContentHash: string): ResearchResult<IssueResolutionContext> {
  if (!isRecord(input) || typeof input.resolutionEvidenceId !== "string" || input.resolutionEvidenceId.trim().length === 0 || !/^[0-9a-f]{64}$/.test(revisionContentHash)) return err(researchError("invalid_research_issue"));
  let briefVersionId: string | undefined;
  if (input.briefVersionId !== undefined) { const parsed = parseResearchIdFor(input.briefVersionId, "rbrf_"); if (!parsed.ok) return parsed; briefVersionId = parsed.value.id; }
  const frozenDecisionIds: string[] = [];
  if (input.frozenDecisionIds !== undefined) {
    if (!Array.isArray(input.frozenDecisionIds)) return err(researchError("invalid_research_issue"));
    for (const value of input.frozenDecisionIds) { const parsed = parseResearchIdFor(value, "rdec_"); if (!parsed.ok || frozenDecisionIds.includes(parsed.value.id)) return err(researchError("invalid_research_issue")); frozenDecisionIds.push(parsed.value.id); }
  }
  frozenDecisionIds.sort();
  return ok(cloneFrozen({ resolutionEvidenceId: input.resolutionEvidenceId.trim(), ...(briefVersionId ? { briefVersionId } : {}), frozenDecisionIds, revisionContentHash }));
}

export function evaluateIssueReopenReasons(resolution: IssueResolutionContext | undefined, contextInput: IssueReopenContext): ResearchResult<readonly string[]> {
  if (!isRecord(contextInput)) return err(researchError("invalid_research_issue"));
  const reasons: string[] = [];
  const currentHash = contextInput.currentRevisionContentHash;
  if (currentHash !== undefined) {
    if (typeof currentHash !== "string" || !/^[0-9a-f]{64}$/.test(currentHash)) return err(researchError("invalid_research_issue"));
    if (resolution !== undefined && currentHash !== resolution.revisionContentHash) reasons.push("revision_content_changed");
  }
  if (contextInput.resolutionEvidenceStale === true) reasons.push("resolution_evidence_stale");
  const currentBriefVersionId = contextInput.currentBriefVersionId;
  if (currentBriefVersionId !== undefined) {
    const id = parseResearchIdFor(currentBriefVersionId, "rbrf_"); if (!id.ok) return id;
    if (resolution?.briefVersionId !== undefined && id.value.id !== resolution.briefVersionId) reasons.push("brief_changed");
  }
  if (contextInput.currentFrozenDecisionIds !== undefined) {
    if (!Array.isArray(contextInput.currentFrozenDecisionIds)) return err(researchError("invalid_research_issue"));
    const current: string[] = [];
    for (const value of contextInput.currentFrozenDecisionIds) { const id = parseResearchIdFor(value, "rdec_"); if (!id.ok || current.includes(id.value.id)) return err(researchError("invalid_research_issue")); current.push(id.value.id); }
    current.sort();
    if (resolution !== undefined && JSON.stringify(current) !== JSON.stringify(resolution.frozenDecisionIds)) reasons.push("frozen_decisions_changed");
  }
  if (contextInput.newEvidenceContradicts === true) reasons.push("contradicting_evidence");
  if (contextInput.userRequested === true) reasons.push("user_requested");
  return ok(cloneFrozen(reasons));
}
