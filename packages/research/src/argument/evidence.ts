import { parseResearchSource, type ResearchSource } from "../authority/source.js";
import { cloneFrozen, isNonBlankString, isRecord } from "../domain-validation.js";
import { researchError } from "../errors.js";
import { parseEntityVersion, type EntityVersion } from "../identity/entity-version.js";
import { parseResearchIdFor } from "../identity/research-id.js";
import { err, ok, type ResearchResult } from "../result.js";

export const EVIDENCE_KINDS = ["artifact_span", "interview_excerpt", "coded_material", "quantitative_result", "policy_text", "literature_source", "user_decision", "system_check"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export const EVIDENCE_STATES = ["current", "stale", "disputed"] as const;
export type EvidenceState = (typeof EVIDENCE_STATES)[number];
export const INFERENCE_CAPACITIES = ["background_only", "descriptive", "interpretive", "associational", "mechanistic", "causal", "normative", "completion"] as const;
export type InferenceCapacity = (typeof INFERENCE_CAPACITIES)[number];

export interface ArgumentEvidence {
  readonly id: string; readonly projectId: string; readonly kind: EvidenceKind; readonly summary: string;
  readonly state: EvidenceState; readonly inferenceCapacity: InferenceCapacity;
  readonly artifactId?: string; readonly revisionId?: string; readonly contentVersionHash?: string;
  readonly source: ResearchSource; readonly version: EntityVersion;
}
export type Evidence = ArgumentEvidence;

export function parseArgumentEvidence(input: unknown): ResearchResult<ArgumentEvidence> {
  if (!isRecord(input) || !EVIDENCE_KINDS.includes(input.kind as EvidenceKind) || !EVIDENCE_STATES.includes(input.state as EvidenceState) || !INFERENCE_CAPACITIES.includes(input.inferenceCapacity as InferenceCapacity) || !isNonBlankString(input.summary)) return err(researchError("invalid_argument_evidence"));
  const id = parseResearchIdFor(input.id, "revd_"); const project = parseResearchIdFor(input.projectId, "rprj_"); const source = parseResearchSource(input.source); const version = parseEntityVersion(input.version);
  let artifactId: string | undefined; let revisionId: string | undefined;
  if (input.artifactId !== undefined || input.revisionId !== undefined) { const artifact = parseResearchIdFor(input.artifactId, "rart_"); const revision = parseResearchIdFor(input.revisionId, "rrev_"); if (!artifact.ok || !revision.ok) return err(researchError("invalid_argument_evidence")); artifactId = artifact.value.id; revisionId = revision.value.id; }
  let contentVersionHash: string | undefined; if (input.contentVersionHash !== undefined) { if (typeof input.contentVersionHash !== "string" || !/^[0-9a-f]{64}$/.test(input.contentVersionHash)) return err(researchError("invalid_argument_evidence")); contentVersionHash = input.contentVersionHash; }
  if (!id.ok || !project.ok || !source.ok || !version.ok || (input.kind === "artifact_span" && (artifactId === undefined || revisionId === undefined || contentVersionHash === undefined))) return err(researchError("invalid_argument_evidence"));
  return ok(cloneFrozen({ id: id.value.id, projectId: project.value.id, kind: input.kind as EvidenceKind, summary: input.summary.trim(), state: input.state as EvidenceState, inferenceCapacity: input.inferenceCapacity as InferenceCapacity, ...(artifactId ? { artifactId, revisionId, ...(contentVersionHash ? { contentVersionHash } : {}) } : {}), source: source.value, version: version.value }));
}
export const parseEvidence = parseArgumentEvidence;
