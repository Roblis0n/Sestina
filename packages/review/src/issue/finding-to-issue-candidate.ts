import {
  ISSUE_KINDS,
  parseResearchSource,
  type IssueKind,
  type ResearchIssueInput,
  type ScopeTarget,
} from "@sestina/research";
import type { Finding } from "../finding.js";
import type { ReviewContext } from "../review-context.js";
import { reviewErr, reviewError, reviewOk, type ReviewResult } from "../review-result.js";

export interface FindingIssueCandidate {
  readonly findingId: string;
  readonly input: ResearchIssueInput;
}

function issueTarget(finding: Finding, context: ReviewContext): ScopeTarget {
  const artifactId = finding.target.artifactId ?? context.episode.artifactId;
  if (finding.target.kind === "block" && finding.target.blockId) return { kind: "block", artifactId, blockId: finding.target.blockId };
  if (finding.target.kind === "path" && finding.target.relativePath) return { kind: "project_path", relativePath: finding.target.relativePath };
  return { kind: "artifact", artifactId };
}

export function findingToIssueCandidate(finding: Finding, context: ReviewContext, recordedAt: string): ReviewResult<FindingIssueCandidate> {
  const source = parseResearchSource({ actor: { kind: "system", component: `review:${finding.checker.id}` }, authority: "system_derived", recordedAt });
  if (!source.ok) return reviewErr(reviewError("invalid_finding"));
  const kind: IssueKind = ISSUE_KINDS.includes(finding.kind as IssueKind) ? finding.kind as IssueKind : "methodological";
  return reviewOk({
    findingId: finding.id,
    input: {
      projectId: context.project.id,
      kind,
      target: issueTarget(finding, context),
      violatedCriterion: finding.kind,
      rationaleConcepts: [finding.kind, finding.checker.id],
      summary: finding.rationale,
      sourceArtifactId: finding.target.artifactId ?? context.episode.artifactId,
      sourceRevisionId: finding.candidateEvidence[0]?.revisionId ?? context.candidateRevision.id,
      sourceRevisionContentHash: context.candidateRevision.contentHash,
      lineageRootRevisionId: context.baselineRevision.id,
      source: source.value,
    },
  });
}
