import type { ResearchSource } from "../authority/source.js";
import { parseResearchSource } from "../authority/source.js";
import { cloneFrozen, isNonBlankString, isRecord } from "../domain-validation.js";
import { researchError } from "../errors.js";
import { parseResearchIdFor } from "../identity/research-id.js";
import { parseEntityVersion, type EntityVersion } from "../identity/entity-version.js";
import { err, ok, type ResearchResult } from "../result.js";

export const SUBSTANTIVE_ARGUMENT_DELTA_KINDS = ["mechanism_relation", "conceptual_distinction", "evidence_link", "counterexample_or_negative_case", "boundary_condition", "alternative_explanation", "causal_step_clarification", "theoretical_contribution", "research_object_transformation"] as const;
export type SubstantiveArgumentDeltaKind = (typeof SUBSTANTIVE_ARGUMENT_DELTA_KINDS)[number];
export const NON_DELTA_KINDS = ["stylistic_rephrase", "abstract_vocabulary_only", "citation_name_drop", "repetition", "length_increase_only", "generic_context_expansion"] as const;
export type NonDeltaKind = (typeof NON_DELTA_KINDS)[number];
export type ArgumentDeltaKind = SubstantiveArgumentDeltaKind | "no_substantive_delta";

export interface ArgumentSpanReference {
  readonly projectId: string;
  readonly artifactId: string;
  readonly revisionId: string;
  readonly normalizedTextHash: string;
  readonly start: number;
  readonly end: number;
  readonly quoteHash: string;
  readonly normalizationVersion: "nfkc-lf-v1";
  readonly indexUnit: "utf16_code_unit";
}

export interface ArgumentDelta {
  readonly id: string;
  readonly projectId: string;
  readonly artifactId: string;
  readonly baselineRevisionId: string;
  readonly candidateRevisionId: string;
  readonly kind: ArgumentDeltaKind;
  readonly nonDeltaKind?: NonDeltaKind;
  readonly baselineGapSpans: readonly ArgumentSpanReference[];
  readonly candidateAdditionSpans: readonly ArgumentSpanReference[];
  readonly relation: string;
  readonly supportsExpectedDeltaId?: string;
  readonly evidenceLinkIds: readonly string[];
  readonly limitations: readonly string[];
  readonly source: ResearchSource;
  readonly version: EntityVersion;
}

function parseSpan(input: unknown, binding: { projectId: string; artifactId: string; revisionId: string }): ResearchResult<ArgumentSpanReference> {
  if (!isRecord(input) || input.projectId !== binding.projectId || input.artifactId !== binding.artifactId || input.revisionId !== binding.revisionId || typeof input.normalizedTextHash !== "string" || !/^[0-9a-f]{64}$/.test(input.normalizedTextHash) || typeof input.quoteHash !== "string" || !/^[0-9a-f]{64}$/.test(input.quoteHash) || !Number.isSafeInteger(input.start) || !Number.isSafeInteger(input.end) || Number(input.start) < 0 || Number(input.end) <= Number(input.start) || input.normalizationVersion !== "nfkc-lf-v1" || input.indexUnit !== "utf16_code_unit") return err(researchError("invalid_argument_delta"));
  return ok(cloneFrozen({ projectId: binding.projectId, artifactId: binding.artifactId, revisionId: binding.revisionId, normalizedTextHash: input.normalizedTextHash, start: Number(input.start), end: Number(input.end), quoteHash: input.quoteHash, normalizationVersion: "nfkc-lf-v1" as const, indexUnit: "utf16_code_unit" as const }));
}

export function parseArgumentDelta(input: unknown): ResearchResult<ArgumentDelta> {
  if (!isRecord(input) || !Array.isArray(input.baselineGapSpans) || !Array.isArray(input.candidateAdditionSpans) || input.baselineGapSpans.length === 0 || input.candidateAdditionSpans.length === 0 || !isNonBlankString(input.relation) || !Array.isArray(input.evidenceLinkIds) || !Array.isArray(input.limitations)) return err(researchError("invalid_argument_delta"));
  const id = parseResearchIdFor(input.id, "rdlt_"); const project = parseResearchIdFor(input.projectId, "rprj_"); const artifact = parseResearchIdFor(input.artifactId, "rart_"); const baseline = parseResearchIdFor(input.baselineRevisionId, "rrev_"); const candidate = parseResearchIdFor(input.candidateRevisionId, "rrev_"); const source = parseResearchSource(input.source); const version = parseEntityVersion(input.version);
  if (!id.ok || !project.ok || !artifact.ok || !baseline.ok || !candidate.ok || baseline.value.id === candidate.value.id || !source.ok || !version.ok) return err(researchError("invalid_argument_delta"));
  const kind = input.kind;
  if (kind !== "no_substantive_delta" && !SUBSTANTIVE_ARGUMENT_DELTA_KINDS.includes(kind as SubstantiveArgumentDeltaKind)) return err(researchError("invalid_argument_delta"));
  let nonDeltaKind: NonDeltaKind | undefined;
  if (input.nonDeltaKind !== undefined) { if (!NON_DELTA_KINDS.includes(input.nonDeltaKind as NonDeltaKind)) return err(researchError("invalid_argument_delta")); nonDeltaKind = input.nonDeltaKind as NonDeltaKind; }
  if ((kind === "no_substantive_delta") !== (nonDeltaKind !== undefined)) return err(researchError("invalid_argument_delta"));
  const baselineSpans: ArgumentSpanReference[] = []; for (const raw of input.baselineGapSpans) { const parsed = parseSpan(raw, { projectId: project.value.id, artifactId: artifact.value.id, revisionId: baseline.value.id }); if (!parsed.ok) return parsed; baselineSpans.push(parsed.value); }
  const candidateSpans: ArgumentSpanReference[] = []; for (const raw of input.candidateAdditionSpans) { const parsed = parseSpan(raw, { projectId: project.value.id, artifactId: artifact.value.id, revisionId: candidate.value.id }); if (!parsed.ok) return parsed; candidateSpans.push(parsed.value); }
  let expected: string | undefined; if (input.supportsExpectedDeltaId !== undefined) { const parsed = parseResearchIdFor(input.supportsExpectedDeltaId, "rbrf_"); if (!parsed.ok) return err(researchError("invalid_argument_delta")); expected = parsed.value.id; }
  const evidence: string[] = []; for (const raw of input.evidenceLinkIds) { const parsed = parseResearchIdFor(raw, "revd_"); if (!parsed.ok || evidence.includes(parsed.value.id)) return err(researchError("invalid_argument_delta")); evidence.push(parsed.value.id); }
  const limitations: string[] = []; for (const raw of input.limitations) { if (!isNonBlankString(raw) || limitations.includes(raw.trim())) return err(researchError("invalid_argument_delta")); limitations.push(raw.trim()); }
  return ok(cloneFrozen({ id: id.value.id, projectId: project.value.id, artifactId: artifact.value.id, baselineRevisionId: baseline.value.id, candidateRevisionId: candidate.value.id, kind: kind as ArgumentDeltaKind, ...(nonDeltaKind ? { nonDeltaKind } : {}), baselineGapSpans: baselineSpans, candidateAdditionSpans: candidateSpans, relation: input.relation.trim(), ...(expected ? { supportsExpectedDeltaId: expected } : {}), evidenceLinkIds: evidence, limitations, source: source.value, version: version.value }));
}

export function parseModelProposedArgumentDelta(input: unknown): ResearchResult<ArgumentDelta> {
  const parsed = parseArgumentDelta(input); if (!parsed.ok) return parsed;
  if (parsed.value.source.authority !== "model_proposed" || parsed.value.source.actor.kind !== "model") return err(researchError("authority_conflict"));
  return parsed;
}
